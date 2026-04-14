require("dotenv").config();
const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

// ===== ENV =====
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

// ===== ROLE IDs =====
const ROLE_ELITE = "1410903958800830474";
const ROLE_CONTRIBUTOR = "1455501575584747663";
const ROLE_LV15 = "1418780779646947408";

// ===== CONFIG =====
const MIN_CONTRIBUTOR = 50;
const MIN_ELITE = 60;
const REQUIRE_CONTRIBUTOR = 200;
const MESSAGE_FILE = path.join(__dirname, "messageCount.json");
const LEADERBOARD_LIMIT = 10;
const WEEKLY_CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 ngày

// ===== VALIDATE ENV =====
if (!TOKEN) {
  throw new Error("Thiếu DISCORD_TOKEN trong file .env");
}

if (!CLIENT_ID) {
  throw new Error("Thiếu CLIENT_ID trong file .env");
}

if (!GUILD_ID) {
  throw new Error("Thiếu GUILD_ID trong file .env");
}

// ===== LOAD / SAVE DATA =====
let messageData = {};

function loadData() {
  try {
    if (!fs.existsSync(MESSAGE_FILE)) {
      fs.writeFileSync(MESSAGE_FILE, JSON.stringify({}, null, 2), "utf8");
      messageData = {};
      return;
    }

    const raw = fs.readFileSync(MESSAGE_FILE, "utf8");
    messageData = raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error("Lỗi khi đọc messageCount.json:", error);
    messageData = {};
  }
}

function saveData() {
  try {
    fs.writeFileSync(MESSAGE_FILE, JSON.stringify(messageData, null, 2), "utf8");
  } catch (error) {
    console.error("Lỗi khi ghi messageCount.json:", error);
  }
}

// ===== WEEK LOGIC: MONDAY -> SUNDAY =====
function getStartOfWeekTimestamp() {
  const now = new Date();

  // Sunday = 0, Monday = 1, Tuesday = 2, ... Saturday = 6
  const day = now.getDay();
  const diffToMonday = day === 0 ? 6 : day - 1;

  const monday = new Date(now);
  monday.setDate(now.getDate() - diffToMonday);
  monday.setHours(0, 0, 0, 0);

  return monday.getTime();
}

function cleanupUserMessages(userId) {
  const startOfWeek = getStartOfWeekTimestamp();

  if (!messageData[userId] || !Array.isArray(messageData[userId])) {
    messageData[userId] = [];
    return;
  }

  messageData[userId] = messageData[userId].filter((timestamp) => {
    return typeof timestamp === "number" && timestamp >= startOfWeek;
  });
}

function cleanupAllMessages() {
  for (const userId of Object.keys(messageData)) {
    cleanupUserMessages(userId);
  }
}

function getWeeklyCount(userId) {
  cleanupUserMessages(userId);
  return messageData[userId]?.length || 0;
}

function getDisplayName(member) {
  return member.nickname || member.user.globalName || member.user.username;
}

async function buildLeaderboard(guild, limit = LEADERBOARD_LIMIT) {
  cleanupAllMessages();

  const rows = [];

  for (const userId of Object.keys(messageData)) {
    const count = getWeeklyCount(userId);
    if (count <= 0) continue;

    let member = null;
    try {
      member = await guild.members.fetch(userId);
    } catch {
      member = null;
    }

    if (!member) continue;
    if (member.user.bot) continue;

    rows.push({
      userId,
      name: getDisplayName(member),
      count,
    });
  }

  rows.sort((a, b) => b.count - a.count);

  return rows.slice(0, limit);
}

// ===== TRACK MESSAGE =====
client.on("messageCreate", (message) => {
  try {
    if (message.author.bot) return;
    if (!message.guild) return;

    const userId = message.author.id;

    if (!messageData[userId] || !Array.isArray(messageData[userId])) {
      messageData[userId] = [];
    }

    cleanupUserMessages(userId);
    messageData[userId].push(Date.now());
    saveData();
  } catch (error) {
    console.error("Lỗi trong messageCreate:", error);
  }
});

// ===== ROLE SCAN =====
async function dailyCheck() {
  console.log("[dailyCheck] Bắt đầu quét role...");

  try {
    const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);

    if (!guild) {
      console.error("[dailyCheck] Không tìm thấy guild.");
      return;
    }

    const fullGuild = await guild.fetch();
    const members = await fullGuild.members.fetch();

    for (const [, member] of members) {
      try {
        if (member.user.bot) continue;

        const count = getWeeklyCount(member.id);

        const hasElite = member.roles.cache.has(ROLE_ELITE);
        const hasContributor = member.roles.cache.has(ROLE_CONTRIBUTOR);
        const hasLv15 = member.roles.cache.has(ROLE_LV15);

        // Gỡ Elite nếu không đủ 60 tin / tuần
        if (hasElite && count < MIN_ELITE) {
          await member.roles.remove(ROLE_ELITE);
          console.log(`[dailyCheck] Removed Elite from ${member.user.tag} | count=${count}`);
        }

        // Gỡ Contributor nếu không đủ 50 tin / tuần
        if (hasContributor && count < MIN_CONTRIBUTOR) {
          await member.roles.remove(ROLE_CONTRIBUTOR);
          console.log(`[dailyCheck] Removed Contributor from ${member.user.tag} | count=${count}`);
        }

        // Cấp Contributor nếu có lv15 và đủ 200 tin / tuần
        // Không auto cấp Elite
        if (!hasContributor && hasLv15 && count >= REQUIRE_CONTRIBUTOR) {
          await member.roles.add(ROLE_CONTRIBUTOR);
          console.log(`[dailyCheck] Added Contributor to ${member.user.tag} | count=${count}`);
        }
      } catch (error) {
        console.error(`[dailyCheck] Lỗi với member ${member.user?.tag || member.id}:`, error);
      }
    }

    cleanupAllMessages();
    saveData();
    console.log("[dailyCheck] Quét xong.");
  } catch (error) {
    console.error("[dailyCheck] Lỗi tổng:", error);
  }
}

// ===== WEEKLY SCHEDULE: SUNDAY 23:00 =====
function getNextSunday23Delay() {
  const now = new Date();
  const target = new Date(now);

  const currentDay = now.getDay(); // Sunday = 0
  let daysUntilSunday = (7 - currentDay) % 7;

  // Nếu hôm nay là Chủ nhật và đã qua 23:00 thì chuyển sang Chủ nhật tuần sau
  if (
    daysUntilSunday === 0 &&
    (
      now.getHours() > 23 ||
      (now.getHours() === 23 && (
        now.getMinutes() > 0 ||
        now.getSeconds() > 0 ||
        now.getMilliseconds() > 0
      ))
    )
  ) {
    daysUntilSunday = 7;
  }

  target.setDate(now.getDate() + daysUntilSunday);
  target.setHours(23, 0, 0, 0);

  return target.getTime() - now.getTime();
}

function formatDelay(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

function scheduleWeeklyCheck() {
  const delay = getNextSunday23Delay();

  console.log(`[schedule] Lần quét tiếp theo sau: ${formatDelay(delay)}`);

  setTimeout(async () => {
    try {
      console.log("[schedule] Đến lịch quét Chủ nhật 23:00");
      await dailyCheck();
    } catch (error) {
      console.error("[schedule] Lỗi khi chạy weekly check:", error);
    }

    setInterval(async () => {
      try {
        console.log("[schedule] Chạy quét định kỳ hằng tuần");
        await dailyCheck();
      } catch (error) {
        console.error("[schedule] Lỗi khi chạy weekly check:", error);
      }
    }, WEEKLY_CHECK_INTERVAL_MS);
  }, delay);
}

// ===== SLASH COMMANDS =====
const commands = [
  new SlashCommandBuilder()
    .setName("check_activity")
    .setDescription("Kiểm tra số tin nhắn tuần này của 1 member")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("Member cần kiểm tra")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Xem top member nhắn tin tuần này"),

  new SlashCommandBuilder()
    .setName("weeklystats")
    .setDescription("Xem bạn đã nhắn bao nhiêu tin trong tuần này"),
].map((command) => command.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

// ===== READY =====
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  loadData();
  cleanupAllMessages();
  saveData();

  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands,
    });
    console.log("Slash commands registered to guild.");
  } catch (error) {
    console.error("Lỗi đăng ký slash command:", error);
  }

  scheduleWeeklyCheck();
});

// ===== HANDLE SLASH =====
client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "check_activity") {
      const user = interaction.options.getUser("user");

      if (!user) {
        await interaction.reply({
          content: "Không tìm thấy user.",
          ephemeral: true,
        });
        return;
      }

      const count = getWeeklyCount(user.id);

      await interaction.reply({
        content: `${user.username} đã nhắn ${count} tin trong tuần này.`,
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === "weeklystats") {
      const count = getWeeklyCount(interaction.user.id);

      await interaction.reply({
        content: `Bạn đã nhắn ${count} tin trong tuần này.`,
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === "leaderboard") {
      const guild = interaction.guild;

      if (!guild) {
        await interaction.reply({
          content: "Lệnh này chỉ dùng được trong server.",
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply();

      const topUsers = await buildLeaderboard(guild, LEADERBOARD_LIMIT);

      if (!topUsers.length) {
        await interaction.editReply("Chưa có dữ liệu tin nhắn trong tuần này.");
        return;
      }

      const lines = topUsers.map((item, index) => {
        return `${index + 1}. ${item.name} — ${item.count} tin`;
      });

      await interaction.editReply(`**Leaderboard tuần này**\n${lines.join("\n")}`);
      return;
    }
  } catch (error) {
    console.error("Lỗi interactionCreate:", error);

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({
        content: "Có lỗi xảy ra khi xử lý lệnh.",
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: "Có lỗi xảy ra khi xử lý lệnh.",
        ephemeral: true,
      });
    }
  }
});

loadData();
client.login(TOKEN);
