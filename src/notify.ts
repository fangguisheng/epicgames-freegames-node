import {
  AppriseNotifier,
  WeixinNotifier,
  DiscordNotifier,
  EmailNotifier,
  LocalNotifier,
  TelegramNotifier,
  GotifyNotifier,
} from './notifiers';
import {
  config,
  DiscordConfig,
  EmailConfig,
  LocalConfig,
  NotificationType,
  TelegramConfig,
  AppriseConfig,
  WeixinConfig,
  PushoverConfig,
  GotifyConfig,
} from './common/config';
import L from './common/logger';
import { NotificationReason } from './interfaces/notification-reason';
import { getDevtoolsUrl, safeLaunchBrowser, safeNewPage } from './common/puppeteer';
import { getLocaltunnelUrl } from './common/localtunnel';
import { PushoverNotifier } from './notifiers/pushover';

export async function sendNotification(
  url: string,
  accountEmail: string,
  reason: NotificationReason
): Promise<void> {
  const account = config.accounts.find((acct) => acct.email === accountEmail);
  const notifierConfigs = account?.notifiers || config.notifiers;
  if (!notifierConfigs || !notifierConfigs.length) {
    L.warn(
      {
        url,
        accountEmail,
        reason,
      },
      `没有全局或针对帐户配置通知程序。你只会得到这份日志`
    );
    return;
  }
  const notifiers = notifierConfigs.map((notifierConfig) => {
    switch (notifierConfig.type) {
      case NotificationType.DISCORD:
        return new DiscordNotifier(notifierConfig as DiscordConfig);
      case NotificationType.PUSHOVER:
        return new PushoverNotifier(notifierConfig as PushoverConfig);
      case NotificationType.EMAIL:
        return new EmailNotifier(notifierConfig as EmailConfig);
      case NotificationType.LOCAL:
        return new LocalNotifier(notifierConfig as LocalConfig);
      case NotificationType.TELEGRAM:
        return new TelegramNotifier(notifierConfig as TelegramConfig);
      case NotificationType.APPRISE:
        return new AppriseNotifier(notifierConfig as AppriseConfig);
        case NotificationType.WEIXIN:
        return new WeixinNotifier(notifierConfig as WeixinConfig);
      case NotificationType.GOTIFY:
        return new GotifyNotifier(notifierConfig as GotifyConfig);
      default:
        throw new Error(`Unexpected notifier config: ${notifierConfig.type}`);
    }
  });

  await Promise.all(
    notifiers.map((notifier) => notifier.sendNotification(url, accountEmail, reason))
  );
}

export async function testNotifiers(): Promise<void> {
  L.info('测试所有配置的通知程序');
  const browser = await safeLaunchBrowser(L);
  const page = await safeNewPage(browser, L);
  L.trace(getDevtoolsUrl(page));
  await page.goto('https://claabs.github.io/epicgames-freegames-node/test.html');
  let url = await page.openPortal();
  if (config.webPortalConfig?.localtunnel) {
    url = await getLocaltunnelUrl(url);
  }
  const accountEmails = config.accounts.map((acct) =>
    sendNotification(url, acct.email, NotificationReason.TEST)
  );
  await Promise.all(accountEmails);
  L.info('已发送测试通知。正在等待测试页交互。。。');
  try {
    await page.waitForSelector('#complete', {
      visible: true,
      timeout: config.notificationTimeoutHours * 60 * 60 * 1000,
    });
    L.info('通知测试完成');
  } catch (err) {
    L.warn('测试通知超时。正在继续。。。');
  }
  await browser.close();
}
