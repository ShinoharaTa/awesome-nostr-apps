import { createCalendarBot } from "./bots/calendar/index.js";
import { createFlowmeterCommandBot } from "./bots/flowmeter-command/index.js";
import { createIoTBot } from "./bots/iot/index.js";
import { createManagementBot } from "./bots/management/index.js";
import { createMonitorBot } from "./bots/monitor/index.js";
import { createSalmonBot } from "./bots/salmon/index.js";
import { loadConfig } from "./config/env.js";
import type { BotHandler } from "./core/bot-handler.js";
import { BotManager } from "./core/bot-manager.js";
import { EventBus } from "./core/event-bus.js";
import { JobRunner } from "./core/job-runner.js";
import { configureLogger, logger } from "./core/logger.js";
import { NostrClient } from "./core/nostr-client.js";
import { SwitchBotClient } from "./integrations/switchbot/index.js";
import { createFlowmeterJob } from "./jobs/flowmeter/index.js";
import { createMetadataRefreshJob } from "./jobs/metadata-refresh/index.js";
import { createPassportJob } from "./jobs/passport/index.js";

async function main(): Promise<void> {
  const config = loadConfig();
  configureLogger(config.logLevel);

  if (config.testMode) {
    logger.info("TEST_MODE enabled: no real publishes or external actions will be performed");
  }

  const client = new NostrClient({
    hex: config.hex,
    relays: config.relays.publish,
    testMode: config.testMode,
  });
  const bus = new EventBus(client, config.relays.subscribe);
  const botManager = new BotManager(client, bus);
  const jobRunner = new JobRunner();

  registerBots(botManager, config);
  registerJobs(jobRunner, client, config);

  botManager.start();
  bus.start();
  jobRunner.start();

  logger.info(`All systems started as ${client.getNpub()}`);

  setupShutdown(bus, jobRunner, client);
}

function registerBots(manager: BotManager, config: ReturnType<typeof loadConfig>): void {
  const cooldown = config.cooldownSec;

  // 管理コマンドは管理者操作なので抑止しない
  manager.register(configure(createManagementBot(manager), config.management.enabled));

  // 応答系 Bot は暴走対策として投稿者ごとにクールダウンを強制する
  manager.register(configure(createSalmonBot(), config.salmon.enabled, cooldown));
  manager.register(
    configure(
      createFlowmeterCommandBot({
        relays: config.flowmeter.relays.map((relay) => relay.url),
        enabled: config.flowmeter.enabled,
      }),
      config.flowmeter.enabled,
      cooldown,
    ),
  );
  manager.register(
    configure(
      createCalendarBot({
        apiKey: config.calendar.apiKey,
        model: config.calendar.model,
      }),
      config.calendar.enabled,
      cooldown,
    ),
  );

  // MonitorBot は Nostr へ応答せず Discord 通知のため抑止対象外
  manager.register(
    configure(
      createMonitorBot({
        webhookUrl: config.monitor.webhookUrl,
        keywords: config.monitor.keywords,
        npubs: config.monitor.npubs,
        mentionNpubs: config.monitor.mentionNpubs,
        testMode: config.testMode,
      }),
      config.monitor.enabled,
    ),
  );

  const switchBot =
    config.iot.token && config.iot.secret
      ? new SwitchBotClient({
          token: config.iot.token,
          secret: config.iot.secret,
          allowControl: config.iot.allowControl,
          testMode: config.testMode,
        })
      : null;
  manager.register(configure(createIoTBot({ switchBot }), config.iot.enabled, cooldown));
}

function configure(handler: BotHandler, enabled: boolean, cooldownSec?: number): BotHandler {
  handler.enabled = enabled;
  if (cooldownSec && cooldownSec > 0) handler.cooldownSec = cooldownSec;
  return handler;
}

function registerJobs(
  runner: JobRunner,
  client: NostrClient,
  config: ReturnType<typeof loadConfig>,
): void {
  runner.register(
    createFlowmeterJob({
      client,
      relays: config.flowmeter.relays,
      schedule: config.flowmeter.cron,
      enabled: config.flowmeter.enabled,
    }),
  );

  runner.register(
    createMetadataRefreshJob({
      keys: config.metadataRefresh.keys,
      relays: config.metadataRefresh.relays,
      schedule: config.metadataRefresh.cron,
      enabled: config.metadataRefresh.enabled,
      testMode: config.testMode,
    }),
  );

  runner.register(
    createPassportJob({
      client,
      key: config.passport.key,
      targetNpub: config.passport.targetNpub,
      schedule: config.passport.cron,
      relays: config.passport.relays,
      enabled: config.passport.enabled,
    }),
  );
}

function setupShutdown(bus: EventBus, jobRunner: JobRunner, client: NostrClient): void {
  const shutdown = (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`);
    bus.stop();
    jobRunner.stop();
    client.close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception", { error: String(error) });
  });
  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled rejection", { reason: String(reason) });
  });
}

main().catch((error) => {
  logger.error("Fatal error during startup", { error: String(error) });
  process.exit(1);
});
