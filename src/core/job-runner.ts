import cron, { type ScheduledTask } from "node-cron";
import { logger } from "./logger.js";

export interface Job {
  name: string;
  /** cron 式 */
  schedule: string;
  enabled: boolean;
  run(): Promise<void>;
  /** 起動直後に一度実行するか */
  runOnStart?: boolean;
}

/**
 * cron ベースの定期ジョブを管理する。イベント駆動 Bot とは別の実行モデル。
 */
export class JobRunner {
  private readonly jobs: Job[] = [];
  private readonly tasks: ScheduledTask[] = [];

  register(job: Job): void {
    this.jobs.push(job);
    logger.info(`Job registered: ${job.name}`, { schedule: job.schedule, enabled: job.enabled });
  }

  start(): void {
    for (const job of this.jobs) {
      if (!job.enabled) continue;

      if (!cron.validate(job.schedule)) {
        logger.error(`Job ${job.name} has invalid cron: ${job.schedule}`);
        continue;
      }

      const task = cron.schedule(job.schedule, () => {
        void this.runJob(job);
      });
      this.tasks.push(task);

      if (job.runOnStart) {
        void this.runJob(job);
      }
    }
    logger.info("JobRunner started");
  }

  private async runJob(job: Job): Promise<void> {
    try {
      logger.info(`Job running: ${job.name}`);
      await job.run();
      logger.info(`Job complete: ${job.name}`);
    } catch (error) {
      logger.error(`Job error: ${job.name}`, { error: String(error) });
    }
  }

  stop(): void {
    for (const task of this.tasks) {
      task.stop();
    }
  }
}
