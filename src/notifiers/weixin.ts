import got from 'got';
import logger from '../common/logger';
import { NotifierService } from './notifier-service';
import { WeixinConfig } from '../common/config';
import { NotificationReason } from '../interfaces/notification-reason';

export class WeixinNotifier extends NotifierService {
  private config: WeixinConfig;

  constructor(config: WeixinConfig) {
    super();

    this.config = config;
  }

  /**
   * @ignore
   */
  async sendNotification(url: string, account: string, reason: NotificationReason): Promise<void> {
    const L = logger.child({ user: account, reason });
    L.trace('发送通知到微信');

    const encodedUrl = encodeURI(url);
    const jsonPayload = {
      urls: this.config.urls,
      title: 'EPIC领取游戏通知',
      body: `epicgames-freegames-node needs a captcha solved.
reason: ${reason}
account: ${account}
url: ${encodedUrl}`,
      format: 'text', // The text format is ugly, but all the platforms support it.
      type: 'info',
    };

    L.trace({ apiUrl: this.config.apiUrl, jsonPayload }, 'Sending json payload');

    try {
      await got.post(`${this.config.apiUrl}&url=${encodedUrl}&title=${reason}&description=${account}`, {
        json: jsonPayload,
        responseType: 'text',
      });
    } catch (err) {
      L.error(err);
      L.error({ urls: this.config.urls }, `Failed to send message`);
      throw err;
    }
  }
}
