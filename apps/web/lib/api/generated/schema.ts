/**
 * 本文件由 `npm run gen:api` 生成，请勿手工修改。
 * 来源：contracts/openapi.json（apps/api/scripts/export_openapi.py 生成）。
 */

export interface paths {
    "/api/v1/health/live": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 进程存活状态
         * @description 只报告进程自身的存活状态（06 §1：liveness 仅判断进程是否响应）。
         *
         *     不查数据库、不查媒体卷、不查 schema。**本文件刻意不提供 `/health/ready`**：
         *     readiness 要验证 DB 可用、schema 版本兼容与媒体目录可用，属 T01 / T10 的实现，
         *     用永远返回 ok 的占位实现冒充就绪被交接计划明确禁止。
         *
         *     响应字段名文档未规定，此处只给最小状态，且不泄漏连接串、目录、数据库名或堆栈。
         */
        get: operations["health_live_api_v1_health_live_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: never;
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    health_live_api_v1_health_live_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: string;
                    };
                };
            };
        };
    };
}
