export default class AppError {
  msg!: string;
  status!: number;
  additionalInfo!: object;

  constructor(msg: string, status = 500, additionalInfo: object = {}) {
    this.msg = msg;
    this.status = status;
    this.additionalInfo = additionalInfo;
  }

  get message(): string {
    return this.msg;
  }
}
