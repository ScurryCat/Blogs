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
    "/api/v1/admin/nav/palaces": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 管理专题列表
         * @description 含草稿与别名冲突提示。按站主手动维护的规模设计，不做批量优化。
         */
        get: operations["admin_list_palaces_api_v1_admin_nav_palaces_get"];
        put?: never;
        /**
         * 新建专题（草稿）
         * @description 新建总是草稿：是否公开由 `publish` 决定（至少一篇公开文章）。
         */
        post: operations["admin_create_palace_api_v1_admin_nav_palaces_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/nav/palaces/{palace_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 管理专题详情（预览） */
        get: operations["admin_read_palace_api_v1_admin_nav_palaces__palace_id__get"];
        put?: never;
        post?: never;
        /**
         * 软删除专题
         * @description 软删除专题，**不删除其中的文章**（05 §7）。
         */
        delete: operations["admin_delete_palace_api_v1_admin_nav_palaces__palace_id__delete"];
        options?: never;
        head?: never;
        /** 更新专题（关系完整替换） */
        patch: operations["admin_update_palace_api_v1_admin_nav_palaces__palace_id__patch"];
        trace?: never;
    };
    "/api/v1/admin/nav/palaces/{palace_id}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 发布专题 */
        post: operations["admin_publish_palace_api_v1_admin_nav_palaces__palace_id__publish_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/nav/palaces/{palace_id}/unpublish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 撤回专题 */
        post: operations["admin_unpublish_palace_api_v1_admin_nav_palaces__palace_id__unpublish_post"];
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
    "/api/v1/nav/palaces": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 可进入的专题列表
         * @description 默认入口：站主已经整理好的专题卡片（04 §4A）。
         *
         *     「已发现」是叙事名称，不代表必须先解谜解锁 —— 所有公开专题都在这里。
         */
        get: operations["list_palaces_api_v1_nav_palaces_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/nav/palaces/{slug}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 公开专题详情
         * @description 草稿、已删除、未发布、没有公开文章与不存在**完全同形**（统一 404）。
         */
        get: operations["read_palace_api_v1_nav_palaces__slug__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/nav/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 认知定位（三关键词匹配）
         * @description 三字段求交集，**确定性地**返回 found / ambiguous / not_found。
         *
         *     不写足迹、不写统计、不需要登录：这是一次普通读取（05 §5）。
         */
        post: operations["resolve_api_v1_nav_resolve_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/nav/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 普通搜索（公开文章与公开专题）
         * @description 首版不检索草稿、图片 EXIF、原始上传名或管理员字段（04 §6）。
         */
        get: operations["search_api_v1_nav_search_get"];
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
        /**
         * PalaceActionIn
         * @description 发布 / 撤回 / 删除的请求体：只需要 CSRF token（版本条件走 `If-Match`）。
         */
        PalaceActionIn: {
            /** Csrf Token */
            csrf_token?: string | null;
        };
        /** PalaceAdminListOut */
        PalaceAdminListOut: {
            /** Items */
            items: components["schemas"]["PalaceAdminOut"][];
            /** Next Cursor */
            next_cursor: string | null;
        };
        /** PalaceAdminOut */
        PalaceAdminOut: {
            /** Aliases */
            aliases: components["schemas"]["PalaceAliasOut"][];
            /** Conflicts */
            conflicts: components["schemas"]["PalaceConflictOut"][];
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Deleted At */
            deleted_at: string | null;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            keywords: components["schemas"]["PalaceKeywordsOut"];
            /** Posts */
            posts: components["schemas"]["PalacePostAdminOut"][];
            /** Public Post Count */
            public_post_count: number;
            /** Published At */
            published_at: string | null;
            /** Slug */
            slug: string;
            /** Status */
            status: string;
            /** Summary */
            summary: string;
            /** Title */
            title: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
            /** Version */
            version: number;
        };
        /** PalaceAliasIn */
        PalaceAliasIn: {
            /**
             * Field
             * @enum {string}
             */
            field: "name" | "location" | "cognition";
            /** Value */
            value: string;
        };
        /** PalaceAliasOut */
        PalaceAliasOut: {
            /** Field */
            field: string;
            /** Normalized Value */
            normalized_value: string;
            /** Value */
            value: string;
        };
        /**
         * PalaceConflictOut
         * @description 别名 / 标准值在其他专题上也出现：允许保存与发布，但管理端必须提示检查。
         *
         *     04 §8：「别名发生重叠时允许返回多候选，但发布预览应提示站主检查」。
         */
        PalaceConflictOut: {
            /** Field */
            field: string;
            /** Normalized Value */
            normalized_value: string;
            /** Palaces */
            palaces: components["schemas"]["PalaceRefOut"][];
            /** Value */
            value: string;
        };
        /** PalaceCreateIn */
        PalaceCreateIn: {
            /** Aliases */
            aliases?: components["schemas"]["PalaceAliasIn"][];
            /** Csrf Token */
            csrf_token?: string | null;
            keywords: components["schemas"]["PalaceKeywordsIn"];
            /** Post Ids */
            post_ids?: string[];
            /** Slug */
            slug: string;
            /**
             * Summary
             * @default
             */
            summary: string;
            /** Title */
            title: string;
        };
        /**
         * PalaceDetailOut
         * @description 公开专题详情：介绍 + 有序公开文章（草稿 / 已撤回的文章不在其中）。
         */
        PalaceDetailOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            keywords: components["schemas"]["PalaceKeywordsOut"];
            /** Post Count */
            post_count: number;
            /** Posts */
            posts: components["schemas"]["PostSummaryOut"][];
            /**
             * Published At
             * Format: date-time
             */
            published_at: string;
            /** Slug */
            slug: string;
            /** Summary */
            summary: string;
            /** Title */
            title: string;
        };
        /** PalaceKeywordsIn */
        PalaceKeywordsIn: {
            /** Cognition */
            cognition: string;
            /** Location */
            location: string;
            /** Name */
            name: string;
        };
        /**
         * PalaceKeywordsOut
         * @description 三项标准关键词（04 §4B 的「目标名 / 现实地点 / 认知形态」）。
         */
        PalaceKeywordsOut: {
            /** Cognition */
            cognition: string;
            /** Location */
            location: string;
            /** Name */
            name: string;
        };
        /** PalaceListOut */
        PalaceListOut: {
            /** Items */
            items: components["schemas"]["PalaceSummaryOut"][];
            /** Next Cursor */
            next_cursor: string | null;
        };
        /**
         * PalacePostAdminOut
         * @description 管理端的文章关系：含草稿 / 已撤回，并标明它当前是否公开（供预览判断）。
         */
        PalacePostAdminOut: {
            /** Deleted */
            deleted: boolean;
            /** Position */
            position: number;
            /**
             * Post Id
             * Format: uuid
             */
            post_id: string;
            /** Public */
            public: boolean;
            /** Slug */
            slug: string;
            /** Status */
            status: string;
            /** Title */
            title: string;
        };
        /** PalaceRefOut */
        PalaceRefOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Slug */
            slug: string;
            /** Status */
            status: string;
            /** Title */
            title: string;
        };
        /**
         * PalaceSummaryOut
         * @description 公开专题摘要。`post_count` 是**每次查询实时统计**的公开文章数，不是缓存的权限条件。
         */
        PalaceSummaryOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            keywords: components["schemas"]["PalaceKeywordsOut"];
            /** Post Count */
            post_count: number;
            /**
             * Published At
             * Format: date-time
             */
            published_at: string;
            /** Slug */
            slug: string;
            /** Summary */
            summary: string;
            /** Title */
            title: string;
        };
        /**
         * PalaceUpdateIn
         * @description PATCH：只更新**出现过的**字段；`aliases` / `post_ids` 传入时完整替换关系列表。
         *
         *     `slug` 不在可改字段里：公开 URL 必须稳定（05 §2「slug 用于公开文章 / 专题 URL，
         *     保持稳定且唯一」）。未知字段一律 422，不静默忽略。
         */
        PalaceUpdateIn: {
            /** Aliases */
            aliases?: components["schemas"]["PalaceAliasIn"][] | null;
            /** Csrf Token */
            csrf_token?: string | null;
            keywords?: components["schemas"]["PalaceKeywordsIn"] | null;
            /** Post Ids */
            post_ids?: string[] | null;
            /** Summary */
            summary?: string | null;
            /** Title */
            title?: string | null;
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
         * ResolveIn
         * @description 认知定位的三字段。无副作用：只读取与匹配（05 §5）。
         */
        ResolveIn: {
            /** Cognition */
            cognition: string;
            /** Location */
            location: string;
            /** Name */
            name: string;
        };
        /**
         * ResolveOut
         * @description `found` / `ambiguous` / `not_found` 三种业务结果，外加成功时的候选列表。
         *
         *     `not_found` 是正常 200 业务结果；服务故障是 5xx，两者不混为一谈（04 §4B / 05 §6）。
         */
        ResolveOut: {
            /** Matches */
            matches: components["schemas"]["PalaceSummaryOut"][];
            /**
             * Status
             * @enum {string}
             */
            status: "found" | "ambiguous" | "not_found";
        };
        /**
         * SearchItemOut
         * @description 搜索结果条目。`href` 由服务端生成，不使用任意第三方重定向地址。
         */
        SearchItemOut: {
            /** Excerpt */
            excerpt: string;
            /** Href */
            href: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Kind
             * @enum {string}
             */
            kind: "post" | "palace";
            /** Slug */
            slug: string;
            /** Title */
            title: string;
        };
        /** SearchListOut */
        SearchListOut: {
            /** Items */
            items: components["schemas"]["SearchItemOut"][];
            /** Next Cursor */
            next_cursor: string | null;
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
    admin_list_palaces_api_v1_admin_nav_palaces_get: {
        parameters: {
            query?: {
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
                    "application/json": components["schemas"]["PalaceAdminListOut"];
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
    admin_create_palace_api_v1_admin_nav_palaces_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PalaceCreateIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PalaceAdminOut"];
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
    admin_read_palace_api_v1_admin_nav_palaces__palace_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                palace_id: string;
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
                    "application/json": components["schemas"]["PalaceAdminOut"];
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
    admin_delete_palace_api_v1_admin_nav_palaces__palace_id__delete: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                palace_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["PalaceActionIn"] | null;
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
    admin_update_palace_api_v1_admin_nav_palaces__palace_id__patch: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                palace_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PalaceUpdateIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PalaceAdminOut"];
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
    admin_publish_palace_api_v1_admin_nav_palaces__palace_id__publish_post: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                palace_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["PalaceActionIn"] | null;
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PalaceAdminOut"];
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
    admin_unpublish_palace_api_v1_admin_nav_palaces__palace_id__unpublish_post: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                palace_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["PalaceActionIn"] | null;
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PalaceAdminOut"];
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
    list_palaces_api_v1_nav_palaces_get: {
        parameters: {
            query?: {
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
                    "application/json": components["schemas"]["PalaceListOut"];
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
    read_palace_api_v1_nav_palaces__slug__get: {
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
                    "application/json": components["schemas"]["PalaceDetailOut"];
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
    resolve_api_v1_nav_resolve_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResolveIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResolveOut"];
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
    search_api_v1_nav_search_get: {
        parameters: {
            query: {
                q: string;
                kind?: ("post" | "palace") | null;
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
                    "application/json": components["schemas"]["SearchListOut"];
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
