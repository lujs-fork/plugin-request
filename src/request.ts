/**
 * Base on https://github.com/umijs/umi-request
 */
import {
  extend,
  Context,
  RequestOptionsInit,
  OnionMiddleware,
  RequestOptionsWithoutResponse,
  RequestMethod,
  RequestOptionsWithResponse,
  RequestResponse,
} from 'umi-request';
import { message, notification } from 'antd';
// @ts-ignore
import history from '@@/history';
import useUmiRequest, { UseRequestProvider } from '@ahooksjs/use-request';
import {
  BaseOptions,
  BasePaginatedOptions,
  BaseResult,
  CombineService,
  LoadMoreFormatReturn,
  LoadMoreOptions,
  LoadMoreOptionsWithFormat,
  LoadMoreParams,
  LoadMoreResult,
  OptionsWithFormat,
  PaginatedFormatReturn,
  PaginatedOptionsWithFormat,
  PaginatedParams,
  PaginatedResult,
} from '@ahooksjs/use-request/lib/types';

type ResultWithData<T = any> = { data: T; [key: string]: any };

function useRequest<R = any, P extends any[] = any, U = any, UU extends U = any>(
  service: CombineService<R, P>,
  options: OptionsWithFormat<R, P, U, UU>,
): BaseResult<U, P>;
function useRequest<R extends ResultWithData = any, P extends any[] = any>(
  service: CombineService<R, P>,
  options?: BaseOptions<R['data'], P>,
): BaseResult<R['data'], P>;
function useRequest<R extends LoadMoreFormatReturn = any, RR = any>(
  service: CombineService<RR, LoadMoreParams<R>>,
  options: LoadMoreOptionsWithFormat<R, RR>,
): LoadMoreResult<R>;
function useRequest<
  R extends ResultWithData<LoadMoreFormatReturn> = any,
  RR extends R = any
>(
  service: CombineService<R, LoadMoreParams<R['data']>>,
  options: LoadMoreOptions<RR['data']>,
): LoadMoreResult<R['data']>;
function useRequest<R = any, Item = any, U extends Item = any>(
  service: CombineService<R, PaginatedParams>,
  options: PaginatedOptionsWithFormat<R, Item, U>,
): PaginatedResult<Item>;
function useRequest<Item = any, U extends Item = any>(
  service: CombineService<ResultWithData<PaginatedFormatReturn<Item>>, PaginatedParams>,
  options: BasePaginatedOptions<U>,
): PaginatedResult<Item>;
function useRequest(service: any, options: any = {}) {
  return useUmiRequest(service, {
    /*FRS*/ formatResult: res => res?.data /*FRE*/,
    requestMethod: (requestOptions: any) => {
      if (typeof requestOptions === 'string') {
        return request(requestOptions);
      } else if (typeof requestOptions === 'object') {
        const { url, ...rest } = requestOptions;
        return request(url, rest);
      }
    },
    ...options,
  });
}

export interface RequestConfig extends RequestOptionsInit {
  errorConfig?: {
    errorPage?: string;
    adaptor?: (resData: any, ctx: Context) => ErrorInfoStructure;
  };
  middlewares?: OnionMiddleware[];
}

export enum ErrorShowType {
  SILENT = 0,
  WARN_MESSAGE = 1,
  ERROR_MESSAGE = 2,
  NOTIFICATION = 4,
  REDIRECT = 9,
}

interface ErrorInfoStructure {
  success: boolean;
  data?: any;
  errorCode?: string;
  errorMessage?: string;
  showType?: ErrorShowType;
  traceId?: string;
  host?: string;
  [key: string]: any;
}

interface RequestError extends Error {
  data?: any;
  info?: ErrorInfoStructure;
  request?: Context['req'];
  response?: Context['res'];
}

const DEFAULT_ERROR_PAGE = '/exception';

let requestMethodInstance: RequestMethod;
const getRequestMethod = () => {
  if (requestMethodInstance) {
    // request method 已经示例化
    return requestMethodInstance;
  }

  // runtime 配置在模块初始化的时候无法获取，所以需要封装一层在异步调用后初始化相关方法
  const requestConfig: RequestConfig =
    require('umi/_runtimePlugin').mergeConfig('request') || {};
  const errorAdaptor = requestConfig.errorConfig?.adaptor || (resData => resData);

  requestMethodInstance = extend({
    errorHandler: (error: RequestError) => {
      // @ts-ignore
      if (error?.request?.options?.skipErrorHandler) {
        throw error;
      }
      let errorInfo: ErrorInfoStructure | undefined;
      if (error.name === 'ResponseError' && error.data && error.request) {
        const ctx: Context = {
          req: error.request,
          res: error.response,
        };
        errorInfo = errorAdaptor(error.data, ctx);
        error.message = errorInfo?.errorMessage || error.message;
        error.data = error.data;
        error.info = errorInfo;
      } else if (error.name === 'AbortError'&& error.request) {
        const ctx: Context = {
          req: error.request,
          res: error.response,
        };
        errorInfo = errorAdaptor(null, ctx);
        error.info = errorInfo;
      }
      
      errorInfo = error.info;


      if (errorInfo) {
        const errorMessage = errorInfo?.errorMessage;
        const errorCode = errorInfo?.errorCode;
        const errorPage = requestConfig.errorConfig?.errorPage || DEFAULT_ERROR_PAGE;

        switch (errorInfo?.showType) {
          case ErrorShowType.SILENT:
            // do nothing
            break;
          case ErrorShowType.WARN_MESSAGE:
            message.warn(errorMessage);
            break;
          case ErrorShowType.ERROR_MESSAGE:
            message.error(errorMessage);
            break;
          case ErrorShowType.NOTIFICATION:
            notification.open({
              message: errorMessage,
            });
            break;
          case ErrorShowType.REDIRECT:
            history.push({
              pathname: errorPage,
              query: { errorCode, errorMessage },
            });
            // redirect to error page
            break;
          default:
            message.error(errorMessage);
            break;
        }
      } else {
        message.error(error.message || 'Request error, please retry.');
      }
      throw error;
    },
    ...requestConfig,
  });

  // 中间件统一错误处理
  // 后端返回格式 { success: boolean, data: any }
  // 按照项目具体情况修改该部分逻辑
  requestMethodInstance.use(async (ctx, next) => {
    await next();
    const { req, res } = ctx;
    // @ts-ignore
    if (req.options?.skipErrorHandler) {
      return;
    }
    const { options } = req;
    const { getResponse } = options;
    const resData = getResponse ? res.data : res;
    const errorInfo = errorAdaptor(resData, ctx);
    if (errorInfo.success === false) {
      // 抛出错误到 errorHandler 中处理
      const error: RequestError = new Error(errorInfo.errorMessage);
      error.name = 'BizError';
      error.data = resData;
      error.info = errorInfo;
      throw error;
    }
  });

  // Add user custom middlewares
  const customMiddlewares = requestConfig.middlewares || [];
  customMiddlewares.forEach(mw => {
    requestMethodInstance.use(mw);
  });
  return requestMethodInstance;
};

interface RequestMethodInUmi<R = false> {
  <T = any>(
    url: string,
    options: RequestOptionsWithResponse & { skipErrorHandler?: boolean },
  ): Promise<RequestResponse<T>>;
  <T = any>(
    url: string,
    options: RequestOptionsWithoutResponse & { skipErrorHandler?: boolean },
  ): Promise<T>;
  <T = any>(
    url: string,
    options?: RequestOptionsInit & { skipErrorHandler?: boolean },
  ): R extends true ? Promise<RequestResponse<T>> : Promise<T>;
}
const request: RequestMethodInUmi = (url: any, options: any) => {
  const requestMethod = getRequestMethod();
  return requestMethod(url, options);
};

export { request, useRequest, UseRequestProvider };
