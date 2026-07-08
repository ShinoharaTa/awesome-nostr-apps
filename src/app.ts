import { createFlowmeterChanBot } from "./bots/flowmeter-command/index.js";
import { createManagementBot } from "./bots/management/index.js";
import { createMonitorBot } from "./bots/monitor/index.js";
import { createShinoemonBot } from "./bots/shinoemon/index.js";
import { type AppConfig, loadConfig } from "./config/env.js";
import type { BotHandler } from "./core/bot-handler.js";
import { BotManager } from "./core/bot-manager.js";
import { EventBus } from "./core/event-bus.js";
import { createIdentity } from "./core/identity.js";
import { JobRunner } from "./core/job-runner.js";
import { configureLogger, logger } from "./core/logger.js";
import { NostrClient } from "./core/nostr-client.js";
import { TempRangeChart } from "./integrations/amedas/chart.js";
import { AmedasClient } from "./integrations/amedas/index.js";
import { Nip96Uploader } from "./integrations/nostr-media/index.js";
import { SwitchBotClient } from "./integrations/switchbot/index.js";
import { createFlowmeterJob } from "./jobs/flowmeter/index.js";
import { createMetadataRefreshJob } from "./jobs/metadata-refresh/index.js";
import { createPassportJob } from "./jobs/passport/index.js";

async function main(): Promise<void> {
  const config = await loadConfig();
  configureLogger(config.logLevel);

  if (config.testMode) {
    logger.info("TEST_MODE enabled: no real publishes or external actions will be performed");
  }

  const client = new NostrClient({
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

  logger.info("All systems started");

  setupShutdown(bus, jobRunner, client);
}

function registerBots(manager: BotManager, config: AppConfig): void {
  const cooldown = config.cooldownSec;

  // 管理コマンドは管理者操作なので抑止しない
  manager.register(
    configure(createManagementBot(manager), {
      enabled: config.management.enabled,
      key: config.management.key,
    }),
  );

  const switchBot =
    config.shinoemon.skills.lightControl && config.shinoemon.token && config.shinoemon.secret
      ? new SwitchBotClient({
          token: config.shinoemon.token,
          secret: config.shinoemon.secret,
          allowControl: config.shinoemon.home.allowControl,
          testMode: config.testMode,
        })
      : null;

  // アメダスは認証不要の公開データなので観測所が設定されていれば常に使う
  const amedas =
    config.shinoemon.home.amedasStations.length > 0
      ? new AmedasClient(config.shinoemon.home.amedasStations)
      : null;

  // 気温レンジグラフはアップロードの NIP-98 署名にしのえもんの鍵を使う
  const tempChart =
    amedas && config.shinoemon.home.amedasChart && config.shinoemon.key
      ? new TempRangeChart({
          stationId: config.shinoemon.home.amedasStations[0],
          amedas,
          uploader: new Nip96Uploader({ signerKey: config.shinoemon.key, testMode: config.testMode }),
        })
      : null;

  // 応答系 Bot は暴走対策として投稿者ごとにクールダウンを強制する
  manager.register(
    configure(
      createShinoemonBot({
        skills: config.shinoemon.skills,
        switchBot,
        amedas,
        tempChart,
        home: config.shinoemon.home,
        calendar: {
          apiKey: config.shinoemon.apiKey,
          model: config.shinoemon.model,
        },
      }),
      {
        enabled: config.shinoemon.enabled,
        cooldownSec: cooldown,
        key: config.shinoemon.key,
      },
    ),
  );
  manager.register(
    configure(
      createFlowmeterChanBot({
        relays: config.flowmeterChan.relays.map((relay) => relay.url),
        enabled: config.flowmeterChan.enabled && config.flowmeterChan.command,
      }),
      {
        enabled: config.flowmeterChan.enabled && config.flowmeterChan.command,
        cooldownSec: cooldown,
        key: config.flowmeterChan.key,
      },
    ),
  );

  // MonitorBot は Nostr へ投稿せず Discord 通知のみ (readOnly)。投稿鍵は不要。
  manager.register(
    configure(
      createMonitorBot({
        webhookUrl: config.monitor.webhookUrl,
        keywords: config.monitor.keywords,
        npubs: config.monitor.npubs,
        mentionNpubs: config.monitor.mentionNpubs,
        testMode: config.testMode,
      }),
      { enabled: config.monitor.enabled },
    ),
  );
}

interface BotSetup {
  enabled: boolean;
  cooldownSec?: number;
  /**
   * 機能ごとの投稿鍵 (hex)。Nostr へ投稿する Bot は必須。
   * readOnly な Bot（MonitorBot など）では渡さない。
   */
  key?: string;
}

function configure(handler: BotHandler, setup: BotSetup): BotHandler {
  handler.enabled = setup.enabled;
  if (setup.cooldownSec && setup.cooldownSec > 0) handler.cooldownSec = setup.cooldownSec;
  if (setup.key) handler.identity = createIdentity(setup.key);
  return handler;
}

function registerJobs(runner: JobRunner, client: NostrClient, config: AppConfig): void {
  runner.register(
    createFlowmeterJob({
      client,
      relays: config.flowmeterChan.relays,
      schedule: config.flowmeterChan.cron,
      enabled: config.flowmeterChan.enabled && config.flowmeterChan.job,
      key: config.flowmeterChan.key,
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
