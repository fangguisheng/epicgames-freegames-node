/* eslint-disable class-methods-use-this */
import 'dotenv/config';
import RandExp from 'randexp';
import { Logger } from 'pino';
import { Page, Protocol, ElementHandle } from 'puppeteer';
// import { writeFileSync } from 'fs-extra';
import { getCookiesRaw, setPuppeteerCookies } from '../../src/common/request';
import { EPIC_CLIENT_ID, STORE_HOMEPAGE_EN } from '../../src/common/constants';
import { getHcaptchaCookies } from '../../src/puppet/hcaptcha';
import puppeteer, {
  toughCookieFileStoreToPuppeteerCookie,
  getDevtoolsUrl,
  launchArgs,
} from '../../src/common/puppeteer';
import logger from '../../src/common/logger';
import Smtp4Dev from './smtp4dev';
import { LocalNotifier } from '../../src/notifiers';

const NOTIFICATION_TIMEOUT = 24 * 60 * 60 * 1000;

export interface AccountManagerProps {
  username?: string;
  password?: string;
  totp?: string;
  country?: string;
}

export default class AccountManager {
  private smtp4dev: Smtp4Dev;

  public email: string;

  public username: string;

  public password: string;

  public country: string;

  public totp?: string;

  private addressHost = process.env.CREATION_EMAIL_HOST || '';

  private L: Logger;

  constructor(props?: AccountManagerProps) {
    if (props?.username) {
      this.username = props?.username;
    } else {
      const randUser = new RandExp(/[0-9a-zA-Z]{8,16}/);
      this.username = randUser.gen();
    }
    if (props?.password) {
      this.password = props?.password;
    } else {
      const randPass = new RandExp(/[a-zA-Z]{4,8}[0-9]{3,8}/);
      this.password = randPass.gen();
    }
    this.country = props?.country || 'United States';
    this.totp = props?.totp;
    this.smtp4dev = new Smtp4Dev({
      apiBaseUrl: process.env.SMTP4DEV_URL || '',
      requestExtensions: {
        username: process.env.SMTP4DEV_USER,
        password: process.env.SMTP4DEV_PASSWORD,
      },
    });
    this.email = `${this.username}@${this.addressHost}`;
    this.L = logger.child({
      username: this.username,
    });
  }

  public logAccountDetails(): void {
    this.L.info({
      email: this.email,
      password: this.password,
      totp: this.totp,
    });
  }

  public async createAccount(): Promise<void> {
    this.L.info({ username: this.username, password: this.password, email: this.email });

    const hCaptchaCookies = await getHcaptchaCookies();
    const userCookies = await getCookiesRaw(this.email);
    const puppeteerCookies = toughCookieFileStoreToPuppeteerCookie(userCookies);
    this.L.debug('Logging in with puppeteer');
    const browser = await puppeteer.launch(launchArgs);
    const page = await browser.newPage();
    this.L.trace(getDevtoolsUrl(page));
    const cdpClient = await page.target().createCDPSession();
    await cdpClient.send('Network.setCookies', {
      cookies: [...puppeteerCookies, ...hCaptchaCookies],
    });
    await page.setCookie(...puppeteerCookies, ...hCaptchaCookies);
    await page.goto(
      `https://www.epicgames.com/id/register/epic?redirect_uri=${STORE_HOMEPAGE_EN}&client_id=${EPIC_CLIENT_ID}`,
      { waitUntil: 'networkidle0' }
    );
    await this.fillDOB(page);
    await this.fillSignUpForm(page);
    await this.handleCaptcha(page);
    await this.fillEmailVerificationForm(page);

    this.L.trace('Saving new cookies');
    const currentUrlCookies = (await cdpClient.send('Network.getAllCookies')) as {
      cookies: Protocol.Network.Cookie[];
    };
    await browser.close();
    setPuppeteerCookies(this.email, currentUrlCookies.cookies);
    this.L.info({ username: this.username, password: this.password, email: this.email });
  }

  private async fillDOB(page: Page): Promise<void> {
    this.L.trace('Getting date fields');
    const [monthInput, dayInput, yearInput] = await Promise.all([
      page.waitForSelector(`#month`) as Promise<ElementHandle<HTMLDivElement>>,
      page.waitForSelector(`#day`) as Promise<ElementHandle<HTMLDivElement>>,
      page.waitForSelector(`#year`) as Promise<ElementHandle<HTMLInputElement>>,
    ]);
    await monthInput.click();
    const month1 = (await page.waitForSelector(
      `ul.MuiList-root > li`
    )) as ElementHandle<HTMLLIElement>;
    await month1.click();
    await page.waitForTimeout(500); // idk why this is required
    await dayInput.click();
    const day1 = (await page.waitForSelector(
      `ul.MuiList-root > li`
    )) as ElementHandle<HTMLLIElement>;
    await day1.click();
    await yearInput.type(this.getRandomInt(1970, 2002).toString());
    const continueButton = (await page.waitForSelector(
      `#continue:not([disabled])`
    )) as ElementHandle<HTMLButtonElement>;
    await page.waitForTimeout(500); // idk why this is required
    this.L.trace('Clicking continueButton');
    await continueButton.click({ delay: 100 });
  }

  public async deleteAccount(): Promise<void> {
    this.L.info({ email: this.email }, 'Deleting account');

    const hCaptchaCookies = await getHcaptchaCookies();
    const userCookies = await getCookiesRaw(this.email);
    const puppeteerCookies = toughCookieFileStoreToPuppeteerCookie(userCookies);
    this.L.debug('Logging in with puppeteer');
    const browser = await puppeteer.launch(launchArgs);
    const page = await browser.newPage();
    this.L.trace(getDevtoolsUrl(page));
    const cdpClient = await page.target().createCDPSession();
    await cdpClient.send('Network.setCookies', {
      cookies: [...puppeteerCookies, ...hCaptchaCookies],
    });
    await page.setCookie(...puppeteerCookies, ...hCaptchaCookies);
    await page.goto(`https://www.epicgames.com/account/personal`, { waitUntil: 'networkidle0' });
    this.L.trace('Waiting for deleteButton');
    const deleteButton = (await page.waitForXPath(
      `//button[contains(., 'Request Account Delete')]`
    )) as ElementHandle<HTMLButtonElement>;
    this.L.trace('Clicking deleteButton');
    await deleteButton.click({ delay: 100 });
    this.L.trace('Waiting for securityCodeInput');
    const securityCodeInput = (await page.waitForSelector(
      `input[name='security-code']`
    )) as ElementHandle<HTMLInputElement>;
    const code = await this.getActionVerification();
    this.L.trace('Filling securityCodeInput');
    await securityCodeInput.type(code);
    this.L.trace('Waiting for confirmButton');
    const confirmButton = (await page.waitForXPath(
      `//button[contains(., 'Confirm Delete Request')]`
    )) as ElementHandle<HTMLButtonElement>;
    this.L.trace('Clicking confirmButton');
    await confirmButton.click({ delay: 100 });
    this.L.trace('Waiting for skipSurveyButton');
    const skipSurveyButton = (await page.waitForSelector(
      `button#deletion-reason-skip`
    )) as ElementHandle<HTMLButtonElement>;
    this.L.trace('Clicking skipSurveyButton');
    await skipSurveyButton.click({ delay: 100 });
    await page.waitForSelector(`div.account-deletion-request-success-modal`);
    this.L.debug('Account deletion successful');

    this.L.trace('Saving new cookies');
    const currentUrlCookies = (await cdpClient.send('Network.getAllCookies')) as {
      cookies: Protocol.Network.Cookie[];
    };
    await browser.close();
    setPuppeteerCookies(this.email, currentUrlCookies.cookies);
  }

  private async fillSignUpForm(page: Page): Promise<void> {
    this.L.trace('Getting sign up fields');
    const randName = new RandExp(/[a-zA-Z]{3,12}/);
    const [
      countryInput,
      firstNameInput,
      lastNameInput,
      displayNameInput,
      emailInput,
      passwordInput,
      tosInput,
    ] = await Promise.all([
      page.waitForSelector(`#country`) as Promise<ElementHandle<Element>>,
      page.waitForSelector(`#name`) as Promise<ElementHandle<HTMLInputElement>>,
      page.waitForSelector(`#lastName`) as Promise<ElementHandle<HTMLInputElement>>,
      page.waitForSelector(`#displayName`) as Promise<ElementHandle<HTMLInputElement>>,
      page.waitForSelector(`#email`) as Promise<ElementHandle<HTMLInputElement>>,
      page.waitForSelector(`#password`) as Promise<ElementHandle<HTMLInputElement>>,
      page.waitForSelector(`#tos`) as Promise<ElementHandle<HTMLInputElement>>,
    ]);
    await countryInput.type(this.country);
    await firstNameInput.type(randName.gen());
    await lastNameInput.type(randName.gen());
    await displayNameInput.type(this.username);
    await emailInput.type(this.email);
    await passwordInput.type(this.password);
    await tosInput.click();
    const submitButton = (await page.waitForSelector(
      `#btn-submit:not([disabled])`
    )) as ElementHandle<HTMLButtonElement>;
    this.L.trace('Clicking submitButton');
    await submitButton.click({ delay: 100 });
  }

  private async waitForHCaptcha(page: Page): Promise<'captcha' | 'nav'> {
    try {
      const talonHandle = await page.$('iframe#talon_frame_registration_prod');
      if (!talonHandle) throw new Error('Could not find talon_frame_registration_prod');
      const talonFrame = await talonHandle.contentFrame();
      if (!talonFrame) throw new Error('Could not find talonFrame contentFrame');
      this.L.trace('Waiting for hcaptcha iframe');
      await talonFrame.waitForSelector(`#challenge_container_hcaptcha > iframe[src*="hcaptcha"]`, {
        visible: true,
      });
      return 'captcha';
    } catch (err) {
      if (err.message.includes('timeout')) {
        throw err;
      }
      if (err.message.includes('detached')) {
        this.L.trace(err);
      } else {
        this.L.warn(err);
      }
      return 'nav';
    }
  }

  private async handleCaptcha(page: Page): Promise<void> {
    const action = await this.waitForHCaptcha(page);
    if (action === 'nav') return;
    this.L.debug('Captcha detected');
    const url = await page.openPortal();
    this.L.info({ url }, '转到此URL并执行某些操作');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new LocalNotifier(null as any).sendNotification(url);
    await page.waitForSelector(`input[name='code-input-0']`, {
      timeout: NOTIFICATION_TIMEOUT,
    });
    await page.closePortal();
  }

  private async fillEmailVerificationForm(page: Page): Promise<void> {
    this.L.trace('Working on email verification form');
    const code = await this.getVerification();
    this.L.trace('Waiting for codeInput');
    const codeInput = (await page.waitForSelector(
      `input[name='code-input-0']`
    )) as ElementHandle<HTMLInputElement>;
    await codeInput.click({ delay: 100 });
    await page.keyboard.type(code);
    this.L.trace('Waiting for continueButton');
    const continueButton = (await page.waitForSelector(
      `#continue:not([disabled])`
    )) as ElementHandle<HTMLButtonElement>;
    this.L.trace('Clicking continueButton');
    await continueButton.click();
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
  }

  private async getVerification(): Promise<string> {
    this.L.debug('Waiting for creation verification email');
    const message = await this.smtp4dev.findNewEmailTo(this.username);
    const emailSource = await this.smtp4dev.getMessageSource(message.id);
    // writeFileSync('email-source.eml', emailSource, 'utf8');
    const codeRegexp = /\\t\\t([0-9]{6})\\n/g;
    const matches = codeRegexp.exec(emailSource);
    if (!matches) throw new Error('No code matches');
    const code = matches[1].trim();
    this.L.debug({ code }, 'Email code');
    return code;
  }

  private async getActionVerification(): Promise<string> {
    this.L.debug('Waiting for action verification email');
    const message = await this.smtp4dev.findNewEmailTo(this.username);
    const emailSource = await this.smtp4dev.getMessageSource(message.id);
    // writeFileSync('email-source.eml', emailSource, 'utf8');
    const codeRegexp = / +([0-9]{6})<br\/><br\/>/g;
    const matches = codeRegexp.exec(emailSource);
    if (!matches) throw new Error('No code matches');
    const code = matches[1].trim();
    this.L.debug({ code }, 'Email code');
    return code;
  }

  private getRandomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1) + min);
  }
}
