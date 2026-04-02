require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const cron = require('node-cron');
const moment = require('moment-timezone');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

const DATA_FILE = './messageCount.json';
const TZ = 'Asia/Ho_Chi_Minh';

const WEEKLY_CONTRIBUTOR_THRESHOLD = 50;
const TOTAL_KHAY_THRESHOLD = 100;

// =========================
// Load / Save DB
// =========================
let db = {
    users: {},
    meta: {
        skipWeeklyResetOnce: false
    }
};

if (fs.existsSync(DATA_FILE)) {
    try {
        const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        db = {
            users: raw.users && typeof raw.users === 'object' ? raw.users : {},
            meta: raw.meta && typeof raw.meta === 'object'
                ? raw.meta
                : { skipWeeklyResetOnce: false }
        };
    } catch (error) {
        console.error('Không đọc được file dữ liệu, tạo DB mới.', error.message);
        db = {
            users: {},
            meta: {
                skipWeeklyResetOnce: false
            }
        };
    }
}

if (!db.users || typeof db.users !== 'object') {
    db.users = {};
}

if (!db.meta || typeof db.meta !== 'object') {
    db.meta = {
        skipWeeklyResetOnce: false
    };
}

if (typeof db.meta.skipWeeklyResetOnce !== 'boolean') {
    db.meta.skipWeeklyResetOnce = false;
}

function saveDB() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function getAllowedChannels() {
    return (process.env.ALLOWED_CHANNELS || '')
        .split(',')
        .map(id => id.trim())
        .filter(Boolean);
}

function ensureUserData(userId) {
    if (!db.users[userId]) {
        db.users[userId] = {
            weeklyCount: 0,
            totalCount: 0,
            lastMessageAt: null
        };
        return;
    }

    // Migrate từ dữ liệu cũ: db.users[userId] = number
    if (typeof db.users[userId] === 'number') {
        db.users[userId] = {
            weeklyCount: db.users[userId],
            totalCount: db.users[userId],
            lastMessageAt: null
        };
        return;
    }

    db.users[userId].weeklyCount = Number(db.users[userId].weeklyCount || 0);
    db.users[userId].totalCount = Number(db.users[userId].totalCount || 0);
    db.users[userId].lastMessageAt = db.users[userId].lastMessageAt || null;
}

// =========================
// Role Logic
// =========================
async function updateRoles(guild) {
    console.log(`[${moment().tz(TZ).format('YYYY-MM-DD HH:mm:ss')}] Bắt đầu quét và cập nhật role...`);

    const roleKhayId = process.env.ROLE_KHAY;
    const roleContribId = process.env.ROLE_CONTRIBUTOR;
    const roleEliteId = process.env.ROLE_ELITE;
    const roleModId = process.env.ROLE_MOD;

    if (!roleKhayId || !roleContribId || !roleEliteId || !roleModId) {
        console.error('Thiếu ROLE_KHAY / ROLE_CONTRIBUTOR / ROLE_ELITE / ROLE_MOD trong environment variables.');
        return;
    }

    const members = await guild.members.fetch();

    for (const [userId] of Object.entries(db.users)) {
        try {
            ensureUserData(userId);
            const userData = db.users[userId];

            const member = members.get(userId);
            if (!member || member.user.bot) continue;

            // Bỏ qua role thủ công
            if (member.roles.cache.has(roleEliteId) || member.roles.cache.has(roleModId)) {
                console.log(`Bỏ qua ${member.user.tag} vì có role Elite hoặc Mod.`);
                continue;
            }

            const weeklyCount = userData.weeklyCount || 0;
            const totalCount = userData.totalCount || 0;

            // Contributor: đủ 50 tin / tuần thì cấp, không đủ thì gỡ
            if (weeklyCount >= WEEKLY_CONTRIBUTOR_THRESHOLD) {
                if (!member.roles.cache.has(roleContribId)) {
                    await member.roles.add(roleContribId);
                    console.log(`Đã cấp Contributor cho ${member.user.tag} (${weeklyCount} tin/tuần).`);
                }
            } else {
                if (member.roles.cache.has(roleContribId)) {
                    await member.roles.remove(roleContribId);
                    console.log(`Đã gỡ Contributor của ${member.user.tag} (${weeklyCount} tin/tuần).`);
                }
            }

            // Khầy: đủ 100 tin tổng thì cấp, không tự gỡ vì inactive
            if (totalCount >= TOTAL_KHAY_THRESHOLD) {
                if (!member.roles.cache.has(roleKhayId)) {
                    await member.roles.add(roleKhayId);
                    console.log(`Đã cấp Khầy cho ${member.user.tag} (${totalCount} tin tổng).`);
                }
            }
        } catch (err) {
            console.error(`Lỗi khi cập nhật role cho ${userId}:`, err.message);
        }
    }

    console.log('Hoàn tất cập nhật role.');
}

// =========================
// Cron Jobs
// =========================

// Chủ nhật 23:59: xét role rồi reset weeklyCount
cron.schedule('59 23 * * 0', async () => {
    console.log('Đang thực hiện cron cuối tuần...');
    const guild = client.guilds.cache.get(process.env.GUILD_ID);

    if (!guild) {
        console.error('Không tìm thấy guild để chạy cron weekly.');
        return;
    }

    if (db.meta.skipWeeklyResetOnce) {
        db.meta.skipWeeklyResetOnce = false;
        saveDB();
        console.log('Đã bỏ qua reset weekly cho tuần này theo lệnh admin.');
        return;
    }

    await updateRoles(guild);

    for (const userId of Object.keys(db.users)) {
        ensureUserData(userId);
        db.users[userId].weeklyCount = 0;
    }

    saveDB();
    console.log('Đã reset weeklyCount cho tuần mới.');
}, { timezone: TZ });

// =========================
// Message Tracking
// =========================
client.on('messageCreate', message => {
    if (message.author.bot || !message.guild) return;

    const allowedChannels = getAllowedChannels();

    if (allowedChannels.length > 0 && !allowedChannels.includes(message.channel.id)) {
        return;
    }

    const userId = message.author.id;
    ensureUserData(userId);

    db.users[userId].weeklyCount += 1;
    db.users[userId].totalCount += 1;
    db.users[userId].lastMessageAt = new Date().toISOString();

    saveDB();
});

// =========================
// Slash Commands
// =========================
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'weekstats') {
        const userId = interaction.user.id;
        ensureUserData(userId);

        const weeklyCount = db.users[userId].weeklyCount || 0;
        const totalCount = db.users[userId].totalCount || 0;
        const lastMessageAt = db.users[userId].lastMessageAt
            ? moment(db.users[userId].lastMessageAt).tz(TZ).format('DD/MM/YYYY HH:mm:ss')
            : 'Chưa có';

        return interaction.reply(
            `Tuần này bạn đã gửi **${weeklyCount}** tin nhắn.\n` +
            `Tổng cộng bạn đã gửi **${totalCount}** tin nhắn.\n` +
            `Tin nhắn gần nhất: **${lastMessageAt}**`
        );
    }

    if (interaction.commandName === 'leaderboard') {
        const sorted = Object.entries(db.users)
            .map(([userId, raw]) => {
                ensureUserData(userId);
                return [userId, db.users[userId]];
            })
            .sort(([, a], [, b]) => b.weeklyCount - a.weeklyCount)
            .slice(0, 10);

        if (!sorted.length) {
            return interaction.reply({
                content: 'Chưa có dữ liệu.',
                ephemeral: true
            });
        }

        const members = await interaction.guild.members.fetch();

        let board = '🏆 **Bảng xếp hạng tuần này:**\n';

        for (let i = 0; i < sorted.length; i++) {
            const [userId, data] = sorted[i];
            const member = members.get(userId);

            const name =
                member?.displayName ||
                member?.user?.globalName ||
                member?.user?.username ||
                `User ${userId}`;

            board += `${i + 1}. ${name}: ${data.weeklyCount} tin\n`;
        }

        return interaction.reply({
            content: board,
            allowedMentions: { parse: [] }
        });
    }

    if (interaction.commandName === 'forcerun') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({
                content: 'Bạn không có quyền dùng lệnh này!',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            await updateRoles(interaction.guild);
            return interaction.editReply('Đã chạy quét role thành công.');
        } catch (error) {
            console.error(error);
            return interaction.editReply('Có lỗi khi chạy quét role.');
        }
    }

    if (interaction.commandName === 'skipreset') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({
                content: 'Bạn không có quyền dùng lệnh này!',
                ephemeral: true
            });
        }

        db.meta.skipWeeklyResetOnce = true;
        saveDB();

        return interaction.reply({
            content: 'Đã bật bỏ qua lần reset weekly kế tiếp.',
            ephemeral: true
        });
    }

    if (interaction.commandName === 'resetstatus') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({
                content: 'Bạn không có quyền dùng lệnh này!',
                ephemeral: true
            });
        }

        return interaction.reply({
            content: db.meta.skipWeeklyResetOnce
                ? 'Hiện đang **BẬT** bỏ qua lần reset weekly kế tiếp.'
                : 'Hiện đang **TẮT** bỏ qua lần reset weekly kế tiếp.',
            ephemeral: true
        });
    }
});

// =========================
// Register Commands
// =========================
const commands = [
    { name: 'weekstats', description: 'Xem số tin nhắn tuần này và tổng số tin nhắn của bạn' },
    { name: 'leaderboard', description: 'Xem top 10 người nhắn tin nhiều nhất trong tuần' },
    { name: 'forcerun', description: 'Admin: Ép bot quét và cập nhật role ngay' },
    { name: 'skipreset', description: 'Admin: Bỏ qua lần reset weekly kế tiếp' },
    { name: 'resetstatus', description: 'Admin: Xem trạng thái bỏ qua reset weekly' }
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('ready', async () => {
    console.log(`Bot đã sẵn sàng! Login dưới tên: ${client.user.tag}`);

    try {
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands }
        );
        console.log('Đã cập nhật Slash Commands.');
    } catch (error) {
        console.error('Lỗi khi đăng ký Slash Commands:', error);
    }
});

client.login(process.env.DISCORD_TOKEN);
