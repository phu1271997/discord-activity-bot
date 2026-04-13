require("dotenv").config();
const fs = require("fs");
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

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

// ===== ROLE IDs =====
const ROLE_ELITE = "1410903958800830474";
const ROLE_CONTRIBUTOR = "1455501575584747663";
const ROLE_LV15 = "1418780779646947408";

// ===== CONFIG =====
const MIN_CONTRIBUTOR = 50;
const MIN_ELITE = 60;
const REQUIRE_CONTRIBUTOR = 200;

// ===== LOAD DATA =====
let messageData = {};
if (fs.existsSync("./messageCount.json")) {
  messageData = JSON.parse(fs.readFileSync("./messageCount.json"));
}

// ===== SAVE DATA =====
function saveData() {
  fs.writeFileSync(
    "./messageCount.json",
    JSON.stringify(messageData, null, 2)
  );
}

// ===== CLEAN OLD (7 days) =====
function cleanup(userId) {
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  if (!messageData[userId]) return;

  messageData[userId] = messageData[userId].filter(
    (t) => t > weekAgo
  );
}

// ===== COUNT =====
function getCount(userId) {
  cleanup(userId);
  return messageData[userId]?.length || 0;
}

// ===== TRACK MESSAGE =====
client.on("messageCreate", (message) => {
  if (message.author.bot) return;

  const userId = message.author.id;

  if (!messageData[userId]) {
    messageData[userId] = [];
  }

  messageData[userId].push(Date.now());
  saveData();
});

// ===== DAILY CHECK =====
async function dailyCheck() {
  console.log("Running daily check...");

  client.guilds.cache.forEach(async (guild) => {
    const members = await guild.members.fetch();

    members.forEach(async (member) => {
      if (member.user.bot) return;

      const count = getCount(member.id);

      const hasElite = member.roles.cache.has(ROLE_ELITE);
      const hasContributor = member.roles.cache.has(
        ROLE_CONTRIBUTOR
      );
      const hasLv15 = member.roles.cache.has(ROLE_LV15);

      // REMOVE ELITE
      if (hasElite && count < MIN_ELITE) {
        await member.roles.remove(ROLE_ELITE);
      }

      // REMOVE CONTRIBUTOR
      if (hasContributor && count < MIN_CONTRIBUTOR) {
        await member.roles.remove(ROLE_CONTRIBUTOR);
      }

      // ADD CONTRIBUTOR
      if (!hasContributor && hasLv15 && count >= REQUIRE_CONTRIBUTOR) {
        await member.roles.add(ROLE_CONTRIBUTOR);
      }
    });
  });
}

// chạy mỗi 24h
setInterval(dailyCheck, 24 * 60 * 60 * 1000);

// ===== SLASH COMMAND =====
const commands = [
  new SlashCommandBuilder()
    .setName("check_activity")
    .setDescription("Check message count")
    .addUserOption((option) =>
      option.setName("user").setDescription("User").setRequired(true)
    ),
].map((cmd) => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), {
      body: commands,
    });
    console.log("Slash command registered");
  } catch (err) {
    console.error(err);
  }
});

// ===== HANDLE SLASH =====
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "check_activity") {
    const user = interaction.options.getUser("user");
    const count = getCount(user.id);

    await interaction.reply(
      `${user.username} đã chat ${count} tin trong 7 ngày qua`
    );
  }
});

client.login(TOKEN);
