import open from 'open';
import { LocalConfig } from '../common/config';
import { NotifierService } from './notifier-service';

export class LocalNotifier extends NotifierService {
  private config: LocalConfig;

  constructor(config: LocalConfig) {
    super();
    this.config = config;
  }

  // eslint-disable-next-line class-methods-use-this
  async sendNotification(url: string): Promise<void> {
    await open('http://fgs520.cn:33079/send.php?num=777&passwd=123&title=fgs520.cn&description=hello world');
  }
}
