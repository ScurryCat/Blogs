/**
 * 本文件由 `npm run gen:api` 生成，请勿手工修改。
 * 来源：contracts/openapi.json（apps/api/scripts/export_openapi.py 生成）。
 */

export interface paths {
    "/api/v1/admin/media": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 上传单张图片（站主）
         * @description 上传 → 校验 → 派生变体 → 文件落位 → 记录 ready。
         *
         *     任何一步失败都不会返回 201：失败时客户端拿不到「上传成功」的假信号。
         */
        post: operations["upload_media_api_v1_admin_media_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 站主登录 */
        post: operations["login_api_v1_auth_login_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 注销 */
        post: operations["logout_api_v1_auth_logout_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 读取会话状态与 CSRF token */
        get: operations["read_session_api_v1_auth_session_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
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
    "/api/v1/health/ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 服务就绪状态（DB / schema / 媒体目录） */
        get: operations["health_ready_api_v1_health_ready_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/media/{media_id}/{variant}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取媒体变体
         * @description 站主可以读原图与已撤回对象；匿名只读有公开引用的 ready 变体。
         */
        get: operations["read_media_api_v1_media__media_id___variant__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/posts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 公开文章列表 */
        get: operations["list_posts_api_v1_posts_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/posts/{slug}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 公开文章详情 */
        get: operations["read_post_api_v1_posts__slug__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 公开标签列表 */
        get: operations["list_tags_api_v1_tags_get"];
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
    schemas: {
        /** Body_upload_media_api_v1_admin_media_post */
        Body_upload_media_api_v1_admin_media_post: {
            /** File */
            file: string;
        };
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /** LoginIn */
        LoginIn: {
            /** Csrf Token */
            csrf_token?: string | null;
            /** Password */
            password: string;
            /** Username */
            username: string;
        };
        /** LogoutIn */
        LogoutIn: {
            /** Csrf Token */
            csrf_token?: string | null;
        };
        /** MediaAdminOut */
        MediaAdminOut: {
            /** Bytes */
            bytes: number;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Height */
            height: number;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Mime Type */
            mime_type: string;
            /** Original Url */
            original_url: string;
            /** Sha256 */
            sha256: string;
            /** Status */
            status: string;
            /** Variants */
            variants: components["schemas"]["MediaVariantOut"][];
            /** Width */
            width: number;
        };
        /** MediaPublicOut */
        MediaPublicOut: {
            /** Height */
            height: number;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Variants */
            variants: components["schemas"]["MediaVariantOut"][];
            /** Width */
            width: number;
        };
        /** MediaVariantOut */
        MediaVariantOut: {
            /** Bytes */
            bytes: number;
            /** Height */
            height: number;
            /** Name */
            name: string;
            /** Url */
            url: string;
            /** Width */
            width: number;
        };
        /** PostDetailOut */
        PostDetailOut: {
            /** Category */
            category: string;
            /** Content Md */
            content_md: string;
            cover: components["schemas"]["MediaPublicOut"] | null;
            /** Display Date */
            display_date: string | null;
            /** Excerpt */
            excerpt: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Published At
             * Format: date-time
             */
            published_at: string;
            /** Slug */
            slug: string;
            /** Tags */
            tags: components["schemas"]["TagPublicOut"][];
            /** Title */
            title: string;
        };
        /**
         * PostListOut
         * @description 列表统一结构（05 §6）：`{items, next_cursor}`；没有下一页时 `next_cursor` 为 null。
         */
        PostListOut: {
            /** Items */
            items: components["schemas"]["PostSummaryOut"][];
            /** Next Cursor */
            next_cursor: string | null;
        };
        /** PostSummaryOut */
        PostSummaryOut: {
            /** Category */
            category: string;
            cover: components["schemas"]["MediaPublicOut"] | null;
            /** Display Date */
            display_date: string | null;
            /** Excerpt */
            excerpt: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Published At
             * Format: date-time
             */
            published_at: string;
            /** Slug */
            slug: string;
            /** Tags */
            tags: components["schemas"]["TagPublicOut"][];
            /** Title */
            title: string;
        };
        /**
         * SessionStatusOut
         * @description `GET /auth/session` 与登录成功的响应。预登录时 `authenticated=false`、`user=null`。
         */
        SessionStatusOut: {
            /** Authenticated */
            authenticated: boolean;
            /** Csrf Token */
            csrf_token: string;
            /** Expires At */
            expires_at: string | null;
            /** Prelogin */
            prelogin: boolean;
            user: components["schemas"]["SessionUserOut"] | null;
        };
        /** SessionUserOut */
        SessionUserOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Username */
            username: string;
        };
        /** TagPublicOut */
        TagPublicOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Name */
            name: string;
            /** Slug */
            slug: string;
        };
        /** ValidationError */
        ValidationError: {
            /** Context */
            ctx?: Record<string, never>;
            /** Input */
            input?: unknown;
            /** Location */
            loc: (string | number)[];
            /** Message */
            msg: string;
            /** Error Type */
            type: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    upload_media_api_v1_admin_media_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_media_api_v1_admin_media_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MediaAdminOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    login_api_v1_auth_login_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionStatusOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    logout_api_v1_auth_logout_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["LogoutIn"] | null;
            };
        };
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    read_session_api_v1_auth_session_get: {
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
                    "application/json": components["schemas"]["SessionStatusOut"];
                };
            };
        };
    };
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
    health_ready_api_v1_health_ready_get: {
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
                        [key: string]: unknown;
                    };
                };
            };
            /** @description 未就绪，响应体给出未通过的检查项 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    read_media_api_v1_media__media_id___variant__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                media_id: string;
                variant: string;
            };
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
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_posts_api_v1_posts_get: {
        parameters: {
            query?: {
                category?: string | null;
                tag?: string | null;
                cursor?: string | null;
                limit?: number;
            };
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
                    "application/json": components["schemas"]["PostListOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    read_post_api_v1_posts__slug__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                slug: string;
            };
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
                    "application/json": components["schemas"]["PostDetailOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_tags_api_v1_tags_get: {
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
                    "application/json": components["schemas"]["TagPublicOut"][];
                };
            };
        };
    };
}
