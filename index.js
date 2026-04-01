require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection, REST, Routes } = require('discord.js');
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

// Load dữ liệu từ file JSON
let db = { users: {} };
if (fs.existsSync(DATA_FILE)) {
    db = JSON.parse(fs.readFileSync(DATA_FILE));
}

function saveDB() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

// Hàm xử lý cập nhật Role
async function updateRoles(guild) {
    console.log(`[${moment().tz(TZ).format()}] Bắt đầu quét và cập nhật role...`);
    const roleKhayId = process.env.ROLE_KHAY;
    const roleContribId = process.env.ROLE_CONTRIBUTOR;
    const roleEliteId = process.env.ROLE_ELITE;
    const roleModId = process.env.ROLE_MOD;

    const members = await guild.members.fetch();

    for (const [userId, count] of Object.entries(db.users)) {
        try {
            const member = members.get(userId);
            if (!member || member.user.bot) continue;

            // Kiểm tra xem có role miễn nhiễm không
            if (member.roles.cache.has(roleEliteId) || member.roles.cache.has(roleModId)) {
                console.log(`Bỏ qua member ${member.user.tag} vì có role ưu tiên.`);
                continue;
            }

            if (count >= 150) {
                await member.roles.add(roleContribId);
                await member.roles.remove(roleKhayId);
            } else if (count >= 100) {
                await member.roles.add(roleKhayId);
                await member.roles.remove(roleContribId);
            } else {
                await member.roles.remove(roleKhayId);
                await member.roles.remove(roleContribId);
            }
        } catch (err) {
            console.error(`Lỗi khi cập nhật role cho ${userId}:`, err.message);
        }
    }
    console.log("Hoàn tất cập nhật role.");
}

// Cron job reset vào 23:59 Chủ Nhật
cron.schedule('59 23 * * 0', async () => {
    console.log("Đang thực hiện reset tuần...");
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (guild) await updateRoles(guild);
    
    db.users = {}; // Reset counts
    saveDB();
    console.log("Đã reset data cho tuần mới.");
}, { timezone: TZ });

client.on('messageCreate', message => {
    if (message.author.bot || !message.guild) return;
    
    const allowedChannels = process.env.ALLOWED_CHANNELS.split(',');
    if (!allowedChannels.includes(message.channel.id)) return;

    const userId = message.author.id;
    db.users[userId] = (db.users[userId] || 0) + 1;
    saveDB();
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'weekstats') {
        const count = db.users[interaction.user.id] || 0;
        await interaction.reply(`Tuần này bạn đã gửi **${count}** tin nhắn.`);
    }

    if (interaction.commandName === 'leaderboard') {
        const sorted = Object.entries(db.users)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10);
        
        let board = "🏆 **Bảng xếp hạng tuần này:**\n";
        for (let i = 0; i < sorted.length; i++) {
            board += `${i + 1}. <@${sorted[i][0]}>: ${sorted[i][1]} tin\n`;
        }
        await interaction.reply(board || "Chưa có dữ liệu.");
    }

    if (interaction.commandName === 'forcerun') {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ content: "Bạn không có quyền!", ephemeral: true });
        }
        await interaction.deferReply();
        await updateRoles(interaction.guild);
        await interaction.editReply("Đã ép buộc chạy quét role thành công.");
    }
});

// Register Slash Commands
const commands = [
    { name: 'weekstats', description: 'Xem số tin nhắn của bạn trong tuần' },
    { name: 'leaderboard', description: 'Xem top 10 người nhắn tin nhiều nhất' },
    { name: 'forcerun', description: 'Admin: Ép buộc quét và cập nhật role ngay lập tức' }
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('ready', async () => {
    console.log(`Bot đã sẵn sàng! Login dưới tên: ${client.user.tag}`);
    try {
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands }
        );
        console.log("Đã cập nhật Slash Commands.");
    } catch (error) {
        console.error(error);
    }
});

client.login(process.env.DISCORD_TOKEN);