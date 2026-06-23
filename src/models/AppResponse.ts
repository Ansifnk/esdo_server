import { PaginationMeta } from '../utils/pagination';

export default class AppResponse {
  msg!: string;
  status!: number;
  data!: object | object[];
  pagination?: PaginationMeta;
  meta?: Record<string, any>;
  /** Set to true to skip response encryption for this specific response, even when globally enabled. */
  skipEncryption: boolean = false;

  constructor(
    msg: string,
    data: object | object[] = {},
    status = 200,
    pagination?: PaginationMeta,
    meta?: Record<string, any>,
    skipEncryption: boolean = false,
  ) {
    this.msg = msg;
    this.status = status;
    this.data = data;
    this.pagination = pagination;
    this.skipEncryption = skipEncryption;
    this.meta = meta;
  }

  toJSON() {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { skipEncryption: _, ...rest } = this;
    return rest;
  }
}
