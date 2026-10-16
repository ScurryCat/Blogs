/**
 * 本文件由 `npm run gen:api` 生成，请勿手工修改。
 * 来源：contracts/openapi.json（apps/api/scripts/export_openapi.py 生成）。
 */

export interface paths {
    "/api/v1/admin/friends": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 管理友链列表
         * @description 含草稿与已删除（`deleted_at` 非空即为已删除，便于管理端区分）。
         */
        get: operations["admin_list_links_api_v1_admin_friends_get"];
        put?: never;
        /**
         * 新建友链（草稿）
         * @description 新建总是草稿；地址在这里就被限制为 http(s)（非法 scheme → 422）。
         */
        post: operations["admin_create_link_api_v1_admin_friends_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/friends/{link_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 管理友链详情 */
        get: operations["admin_read_link_api_v1_admin_friends__link_id__get"];
        put?: never;
        post?: never;
        /**
         * 软删除友链
         * @description 软删除该友链；**不删除媒体对象**，也不影响同一张图在其他公开内容里的引用。
         */
        delete: operations["admin_delete_link_api_v1_admin_friends__link_id__delete"];
        options?: never;
        head?: never;
        /** 更新友链（tags 完整替换） */
        patch: operations["admin_update_link_api_v1_admin_friends__link_id__patch"];
        trace?: never;
    };
    "/api/v1/admin/friends/{link_id}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 发布友链 */
        post: operations["admin_publish_link_api_v1_admin_friends__link_id__publish_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/friends/{link_id}/unpublish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 撤回友链 */
        post: operations["admin_unpublish_link_api_v1_admin_friends__link_id__unpublish_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/journal/entries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 管理手记列表 */
        get: operations["admin_list_entries_api_v1_admin_journal_entries_get"];
        put?: never;
        /**
         * 新建手记（草稿 + 仅自己可见）
         * @description 新建**总是** draft + private：公开必须先显式发布，再显式切为 public。
         */
        post: operations["admin_create_entry_api_v1_admin_journal_entries_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/journal/entries/{entry_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 管理手记详情（预览） */
        get: operations["admin_read_entry_api_v1_admin_journal_entries__entry_id__get"];
        put?: never;
        post?: never;
        /** 软删除手记 */
        delete: operations["admin_delete_entry_api_v1_admin_journal_entries__entry_id__delete"];
        options?: never;
        head?: never;
        /** 更新手记（图片完整替换） */
        patch: operations["admin_update_entry_api_v1_admin_journal_entries__entry_id__patch"];
        trace?: never;
    };
    "/api/v1/admin/journal/entries/{entry_id}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 发布手记 */
        post: operations["admin_publish_entry_api_v1_admin_journal_entries__entry_id__publish_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/journal/entries/{entry_id}/unpublish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 撤回手记 */
        post: operations["admin_unpublish_entry_api_v1_admin_journal_entries__entry_id__unpublish_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/journal/entries/{entry_id}/visibility": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 切换可见性（public / private，立即生效）
         * @description 切换后公开端点**立即**遵守（验收 1）：没有缓存需要失效。
         */
        post: operations["admin_set_visibility_api_v1_admin_journal_entries__entry_id__visibility_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/leisure/entries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 管理列表 */
        get: operations["admin_list_entries_api_v1_admin_leisure_entries_get"];
        put?: never;
        /** 新建（草稿） */
        post: operations["admin_create_entry_api_v1_admin_leisure_entries_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/leisure/entries/{entry_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 管理详情（预览） */
        get: operations["admin_read_entry_api_v1_admin_leisure_entries__entry_id__get"];
        put?: never;
        post?: never;
        /** 软删除 */
        delete: operations["admin_delete_entry_api_v1_admin_leisure_entries__entry_id__delete"];
        options?: never;
        head?: never;
        /** 更新 */
        patch: operations["admin_update_entry_api_v1_admin_leisure_entries__entry_id__patch"];
        trace?: never;
    };
    "/api/v1/admin/leisure/entries/{entry_id}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 发布 */
        post: operations["admin_publish_entry_api_v1_admin_leisure_entries__entry_id__publish_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/leisure/entries/{entry_id}/unpublish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 撤回 */
        post: operations["admin_unpublish_entry_api_v1_admin_leisure_entries__entry_id__unpublish_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
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
    "/api/v1/admin/moments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 管理列表（含草稿） */
        get: operations["list_admin_moments_api_v1_admin_moments_get"];
        put?: never;
        /** 新建草稿 */
        post: operations["create_moment_api_v1_admin_moments_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/moments/{moment_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 读取动态（草稿 / 预览） */
        get: operations["read_admin_moment_api_v1_admin_moments__moment_id__get"];
        put?: never;
        post?: never;
        /** 软删除动态 */
        delete: operations["delete_moment_api_v1_admin_moments__moment_id__delete"];
        options?: never;
        head?: never;
        /** 更新动态 */
        patch: operations["update_moment_api_v1_admin_moments__moment_id__patch"];
        trace?: never;
    };
    "/api/v1/admin/moments/{moment_id}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 发布动态 */
        post: operations["publish_moment_api_v1_admin_moments__moment_id__publish_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/moments/{moment_id}/unpublish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 撤回动态 */
        post: operations["unpublish_moment_api_v1_admin_moments__moment_id__unpublish_post"];
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
    "/api/v1/coop/links": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 友链列表
         * @description 按站主手动排序返回已发布友链；`tag` 为精确（规范化后）筛选。
         */
        get: operations["list_links_api_v1_coop_links_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/coop/links/{link_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 友链详情
         * @description 草稿、已删除与不存在**完全同形**（统一 404），不泄漏「这条存在但没发布」。
         */
        get: operations["read_link_api_v1_coop_links__link_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/coop/tags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 友链标签
         * @description 只返回已发布友链用到的标签；不返回数量，也不按热度排序。
         */
        get: operations["list_tags_api_v1_coop_tags_get"];
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
    "/api/v1/journal/calendar": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 公开日历（只含公开记录）
         * @description 与列表**同一份数据**：空日期就是空日期，不显示被隐藏记录的数量。
         */
        get: operations["read_calendar_api_v1_journal_calendar_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/journal/entries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 公开手记列表
         * @description 按日期倒序的存档卡列表。只返回已发布且 public 的记录。
         */
        get: operations["list_entries_api_v1_journal_entries_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/journal/entries/{entry_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 公开手记正文 */
        get: operations["read_entry_api_v1_journal_entries__entry_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/leisure/entries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 公开追番 / 游戏列表 */
        get: operations["list_entries_api_v1_leisure_entries_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/leisure/entries/{entry_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 公开条目详情 */
        get: operations["read_entry_api_v1_leisure_entries__entry_id__get"];
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
    "/api/v1/moments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 公开图文列表 */
        get: operations["list_moments_api_v1_moments_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/moments/{moment_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 公开图文详情 */
        get: operations["read_moment_api_v1_moments__moment_id__get"];
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
        /**
         * AnimeProgressOut
         * @description 追番进度。`total_episodes` / `completion_ratio` 为 null 表示总数未知。
         */
        AnimeProgressOut: {
            /** Airing */
            airing: boolean | null;
            /** Completion Ratio */
            completion_ratio: number | null;
            /** Episodes Label */
            episodes_label: string;
            /** Episodes Watched */
            episodes_watched: number | null;
            /** Last Watched On */
            last_watched_on: string | null;
            /** Season */
            season: string | null;
            /** Total Episodes */
            total_episodes: number | null;
        };
        /** Body_upload_media_api_v1_admin_media_post */
        Body_upload_media_api_v1_admin_media_post: {
            /** File */
            file: string;
        };
        /**
         * FriendLinkActionIn
         * @description 发布 / 撤回 / 删除的无实体请求体：只承载 CSRF token。
         */
        FriendLinkActionIn: {
            /** Csrf Token */
            csrf_token?: string | null;
        };
        /** FriendLinkAdminListOut */
        FriendLinkAdminListOut: {
            /** Items */
            items: components["schemas"]["FriendLinkAdminOut"][];
            /** Next Cursor */
            next_cursor: string | null;
        };
        /** FriendLinkAdminOut */
        FriendLinkAdminOut: {
            /** Arcana */
            arcana: string | null;
            avatar: components["schemas"]["MediaPublicOut"] | null;
            /** Avatar Media Id */
            avatar_media_id: string | null;
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
            /** Name */
            name: string;
            /** Position */
            position: number;
            /** Published At */
            published_at: string | null;
            /** Status */
            status: string;
            /** Story */
            story: string | null;
            /** Summary */
            summary: string;
            /** Tags */
            tags: components["schemas"]["FriendTagOut"][];
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
            /** Url */
            url: string;
            /** Version */
            version: number;
        };
        /** FriendLinkCreateIn */
        FriendLinkCreateIn: {
            /** Arcana */
            arcana?: string | null;
            /** Avatar Media Id */
            avatar_media_id?: string | null;
            /** Csrf Token */
            csrf_token?: string | null;
            /** Name */
            name: string;
            /**
             * Position
             * @default 0
             */
            position: number;
            /** Story */
            story?: string | null;
            /**
             * Summary
             * @default
             */
            summary: string;
            /** Tags */
            tags?: string[];
            /** Url */
            url: string;
        };
        /** FriendLinkDetailOut */
        FriendLinkDetailOut: {
            /** Arcana */
            arcana: string | null;
            avatar: components["schemas"]["MediaPublicOut"] | null;
            /** Has Story */
            has_story: boolean;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Name */
            name: string;
            /** Story */
            story: string | null;
            /** Summary */
            summary: string;
            /** Tags */
            tags: string[];
            /** Url */
            url: string;
        };
        /** FriendLinkListOut */
        FriendLinkListOut: {
            /** Items */
            items: components["schemas"]["FriendLinkSummaryOut"][];
            /** Next Cursor */
            next_cursor: string | null;
        };
        /** FriendLinkSummaryOut */
        FriendLinkSummaryOut: {
            /** Arcana */
            arcana: string | null;
            avatar: components["schemas"]["MediaPublicOut"] | null;
            /** Has Story */
            has_story: boolean;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Name */
            name: string;
            /** Summary */
            summary: string;
            /** Tags */
            tags: string[];
            /** Url */
            url: string;
        };
        /**
         * FriendLinkUpdateIn
         * @description PATCH：只更新**出现过的**字段（`model_fields_set`）；`tags` 传入时完整替换。
         *
         *     `status` / `slug` / 版本都不在可改字段里：发布与撤回是独立动作，版本只能靠 If-Match 推进。
         */
        FriendLinkUpdateIn: {
            /** Arcana */
            arcana?: string | null;
            /** Avatar Media Id */
            avatar_media_id?: string | null;
            /** Csrf Token */
            csrf_token?: string | null;
            /** Name */
            name?: string | null;
            /** Position */
            position?: number | null;
            /** Story */
            story?: string | null;
            /** Summary */
            summary?: string | null;
            /** Tags */
            tags?: string[] | null;
            /** Url */
            url?: string | null;
        };
        /**
         * FriendTagListOut
         * @description 公开标签清单（只来自已发布友链），供筛选器使用；不带任何计数或排名。
         */
        FriendTagListOut: {
            /** Items */
            items: components["schemas"]["FriendTagOut"][];
        };
        /**
         * FriendTagOut
         * @description 标签的公开形态：只有展示名与规范值（筛选用）。
         */
        FriendTagOut: {
            /** Name */
            name: string;
            /** Normalized */
            normalized: string;
        };
        /** GameProgressOut */
        GameProgressOut: {
            /** All Achievements */
            all_achievements: boolean | null;
            /** Completed On */
            completed_on: string | null;
            /** Platform */
            platform: string;
            /** Playtime Label */
            playtime_label: string;
            /** Playtime Minutes */
            playtime_minutes: number | null;
            /** Started On */
            started_on: string | null;
        };
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /**
         * JournalAdminImageOut
         * @description 管理端图片：给出可直接回填的引用 + 当前是否还有公开引用。
         *
         *     `still_public` 说明「这张图即使本篇日记转私密，也可能因为别的公开引用
         *     （公开相册 / 公开动态）继续公开」。管理端必须如实提示，不能声称
         *     「撤回了日记，图就没了」（05 §11）。
         */
        JournalAdminImageOut: {
            /** Alt */
            alt: string;
            /** Height */
            height: number;
            /**
             * Media Id
             * Format: uuid
             */
            media_id: string;
            /** Position */
            position: number;
            /** Still Public */
            still_public: boolean;
            /** Width */
            width: number;
        };
        /** JournalAdminListOut */
        JournalAdminListOut: {
            /** Items */
            items: components["schemas"]["JournalAdminOut"][];
            /** Next Cursor */
            next_cursor: string | null;
        };
        /** JournalAdminOut */
        JournalAdminOut: {
            /** Content Md */
            content_md: string;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Deleted At */
            deleted_at: string | null;
            /**
             * Entry Date
             * Format: date
             */
            entry_date: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Images */
            images: components["schemas"]["JournalAdminImageOut"][];
            /** Location */
            location: string;
            /** Mood */
            mood: string;
            post: components["schemas"]["JournalPostRefOut"] | null;
            /** Public */
            public: boolean;
            /** Published At */
            published_at: string | null;
            /** Shared Media */
            shared_media: string[];
            /**
             * Status
             * @enum {string}
             */
            status: "draft" | "published";
            /** Title */
            title: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
            /** Version */
            version: number;
            /**
             * Visibility
             * @enum {string}
             */
            visibility: "private" | "public";
        };
        /**
         * JournalCalendarMonthOut
         * @description 一个月：只有**真的存在公开记录**的日期才有计数。
         *
         *     空月份不出现在列表里，空日期不出现在 `days` 里 —— 不生成「欠写」提醒，
         *     也不会因为被隐藏的记录而出现一个没有内容的日期。
         */
        JournalCalendarMonthOut: {
            /** Days */
            days: {
                [key: string]: number;
            };
            /** Month */
            month: string;
        };
        /**
         * JournalCalendarOut
         * @description 公开日历：与列表**同一份数据**，只聚合真正公开的记录。
         */
        JournalCalendarOut: {
            /** Months */
            months: components["schemas"]["JournalCalendarMonthOut"][];
            /** Timezone */
            timezone: string;
            /**
             * Today
             * Format: date
             */
            today: string;
            /** Total Entries */
            total_entries: number;
        };
        /**
         * JournalCreateIn
         * @description 新建。**没有** `status` / `visibility` 字段：新建永远是 draft + private。
         *
         *     这是刻意的：07 §3 要求「建议新增日记时默认为草稿且仅自己可见」。
         *     要公开必须先写下来，再显式发布并切为 public —— 两步都要站主主动做。
         */
        JournalCreateIn: {
            /**
             * Content Md
             * @default
             */
            content_md: string;
            /** Csrf Token */
            csrf_token?: string | null;
            /**
             * Entry Date
             * Format: date
             */
            entry_date: string;
            /** Images */
            images?: components["schemas"]["JournalImageIn"][];
            /**
             * Location
             * @default
             */
            location: string;
            /**
             * Mood
             * @default
             */
            mood: string;
            /** Post Id */
            post_id?: string | null;
            /**
             * Title
             * @default
             */
            title: string;
        };
        /**
         * JournalEntryDetailOut
         * @description 正文页：`content_md` 是唯一正文来源（05 §3：不把渲染 HTML 当存档）。
         */
        JournalEntryDetailOut: {
            /** Content Md */
            content_md: string;
            /**
             * Entry Date
             * Format: date
             */
            entry_date: string;
            /** Excerpt */
            excerpt: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Images */
            images: components["schemas"]["JournalImageOut"][];
            /** Location */
            location: string;
            /** Mood */
            mood: string;
            post: components["schemas"]["JournalPostRefOut"] | null;
            /** Title */
            title: string;
        };
        /** JournalEntryListOut */
        JournalEntryListOut: {
            /** Items */
            items: components["schemas"]["JournalEntrySummaryOut"][];
            /** Next Cursor */
            next_cursor: string | null;
        };
        /**
         * JournalEntrySummaryOut
         * @description 存档卡式列表项（07 §3：日期、星期由前端按同一日期字符串算，不重复传输）。
         */
        JournalEntrySummaryOut: {
            /**
             * Entry Date
             * Format: date
             */
            entry_date: string;
            /** Excerpt */
            excerpt: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Images */
            images: components["schemas"]["JournalImageOut"][];
            /** Location */
            location: string;
            /** Mood */
            mood: string;
            /** Title */
            title: string;
        };
        /** JournalImageIn */
        JournalImageIn: {
            /** Alt */
            alt: string;
            /**
             * Media Id
             * Format: uuid
             */
            media_id: string;
            /** Position */
            position: number;
        };
        /**
         * JournalImageOut
         * @description 公开图片：只给读取需要的字段，不含 `storage_key` / 原始文件名。
         */
        JournalImageOut: {
            /** Alt */
            alt: string;
            /** Height */
            height: number;
            /**
             * Media Id
             * Format: uuid
             */
            media_id: string;
            /** Position */
            position: number;
            /** Variants */
            variants: components["schemas"]["MediaVariantOut"][];
            /** Width */
            width: number;
        };
        /**
         * JournalPostRefOut
         * @description 可选的长文引用。`public` 由服务端按公开条件实时判定，管理端用来提示。
         */
        JournalPostRefOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Public */
            public: boolean;
            /** Slug */
            slug: string;
            /** Status */
            status: string;
            /** Title */
            title: string;
        };
        /**
         * JournalUpdateIn
         * @description PATCH：只改出现过的字段；`images` 传入时**完整替换**有序关系。
         *
         *     显式 `null` 与「没传」是两回事：要清空 `post_id` 请传 `null`（它是可空关系），
         *     其它字段传 `null` 一律 422。
         */
        JournalUpdateIn: {
            /** Content Md */
            content_md?: string | null;
            /** Csrf Token */
            csrf_token?: string | null;
            /** Entry Date */
            entry_date?: string | null;
            /** Images */
            images?: components["schemas"]["JournalImageIn"][] | null;
            /** Location */
            location?: string | null;
            /** Mood */
            mood?: string | null;
            /** Post Id */
            post_id?: string | null;
            /** Title */
            title?: string | null;
        };
        /**
         * JournalVisibilityIn
         * @description 可见性 / 发布动作的请求体。
         *
         *     切为 `private` 用它与 PATCH 同样的一条路径，**立即对新请求生效**
         *     （验收 1）：公开条件写在 SQL 里，不依赖任何缓存失效或重建。
         */
        JournalVisibilityIn: {
            /** Csrf Token */
            csrf_token?: string | null;
        };
        /**
         * LeisureActionIn
         * @description 发布 / 撤回的请求体（版本条件走 `If-Match`，与 nav / moments 一致）。
         */
        LeisureActionIn: {
            /** Csrf Token */
            csrf_token?: string | null;
        };
        /** LeisureAdminListOut */
        LeisureAdminListOut: {
            /** Items */
            items: components["schemas"]["LeisureAdminOut"][];
            /** Next Cursor */
            next_cursor: string | null;
        };
        /** LeisureAdminOut */
        LeisureAdminOut: {
            anime: components["schemas"]["AnimeProgressOut"] | null;
            /** Cover */
            cover: {
                [key: string]: unknown;
            } | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Deleted At */
            deleted_at: string | null;
            game: components["schemas"]["GameProgressOut"] | null;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Kind
             * @enum {string}
             */
            kind: "anime" | "game";
            /** Notes */
            notes: string;
            /** Notes Have Spoilers */
            notes_have_spoilers: boolean;
            /** Progress */
            progress: string;
            /** Progress Label */
            progress_label: string;
            /** Public */
            public: boolean;
            /** Published At */
            published_at: string | null;
            /** Rating */
            rating: number | null;
            review: components["schemas"]["ReviewRefOut"] | null;
            /** Review Post Id */
            review_post_id: string | null;
            /**
             * Status
             * @enum {string}
             */
            status: "draft" | "published";
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
        /**
         * LeisureCreateIn
         * @description 新建。**总是草稿**：`status` 不在写入字段里，发布是独立动作。
         */
        LeisureCreateIn: {
            /** Airing */
            airing?: boolean | null;
            /** All Achievements */
            all_achievements?: boolean | null;
            /** Completed On */
            completed_on?: string | null;
            /** Cover Media Id */
            cover_media_id?: string | null;
            /** Csrf Token */
            csrf_token?: string | null;
            /** Episodes Watched */
            episodes_watched?: number | null;
            /**
             * Kind
             * @enum {string}
             */
            kind: "anime" | "game";
            /** Last Watched On */
            last_watched_on?: string | null;
            /**
             * Notes
             * @default
             */
            notes: string;
            /**
             * Notes Have Spoilers
             * @default false
             */
            notes_have_spoilers: boolean;
            /**
             * Platform
             * @default
             */
            platform: string;
            /** Playtime Minutes */
            playtime_minutes?: number | null;
            /** Progress */
            progress?: string | null;
            /** Rating */
            rating?: number | null;
            /** Review Post Id */
            review_post_id?: string | null;
            /** Season */
            season?: string | null;
            /** Started On */
            started_on?: string | null;
            /** Title */
            title: string;
            /** Total Episodes */
            total_episodes?: number | null;
        };
        /** LeisureEntryOut */
        LeisureEntryOut: {
            anime: components["schemas"]["AnimeProgressOut"] | null;
            /** Cover */
            cover: {
                [key: string]: unknown;
            } | null;
            game: components["schemas"]["GameProgressOut"] | null;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Kind
             * @enum {string}
             */
            kind: "anime" | "game";
            /** Notes */
            notes: string;
            /** Notes Have Spoilers */
            notes_have_spoilers: boolean;
            /** Progress */
            progress: string;
            /** Progress Label */
            progress_label: string;
            /** Rating */
            rating: number | null;
            review: components["schemas"]["ReviewRefOut"] | null;
            /** Title */
            title: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /** LeisureListOut */
        LeisureListOut: {
            /** Items */
            items: components["schemas"]["LeisureEntryOut"][];
            /** Next Cursor */
            next_cursor: string | null;
        };
        /**
         * LeisureUpdateIn
         * @description PATCH：只改出现过的字段。
         *
         *     可空字段（`rating` / `season` / `total_episodes` / `episodes_watched` /
         *     `last_watched_on` / `airing` / `playtime_minutes` / `started_on` /
         *     `completed_on` / `all_achievements` / `cover_media_id` / `review_post_id`）
         *     传 `null` 就是**清空**（例如「把评分改回未评分」）。
         *     `title` / `notes` / `platform` / `notes_have_spoilers` 传 `null` 一律 422。
         */
        LeisureUpdateIn: {
            /** Airing */
            airing?: boolean | null;
            /** All Achievements */
            all_achievements?: boolean | null;
            /** Completed On */
            completed_on?: string | null;
            /** Cover Media Id */
            cover_media_id?: string | null;
            /** Csrf Token */
            csrf_token?: string | null;
            /** Episodes Watched */
            episodes_watched?: number | null;
            /** Last Watched On */
            last_watched_on?: string | null;
            /** Notes */
            notes?: string | null;
            /** Notes Have Spoilers */
            notes_have_spoilers?: boolean | null;
            /** Platform */
            platform?: string | null;
            /** Playtime Minutes */
            playtime_minutes?: number | null;
            /** Progress */
            progress?: string | null;
            /** Rating */
            rating?: number | null;
            /** Review Post Id */
            review_post_id?: string | null;
            /** Season */
            season?: string | null;
            /** Started On */
            started_on?: string | null;
            /** Title */
            title?: string | null;
            /** Total Episodes */
            total_episodes?: number | null;
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
        /** MomentAdminListOut */
        MomentAdminListOut: {
            /** Items */
            items: components["schemas"]["MomentAdminOut"][];
            /** Next Cursor */
            next_cursor: string | null;
        };
        /** MomentAdminOut */
        MomentAdminOut: {
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Images */
            images: components["schemas"]["MomentImageOut"][];
            /** Images Admin */
            images_admin: components["schemas"]["MomentImageAdminOut"][];
            /** Published At */
            published_at: string | null;
            /**
             * Status
             * @enum {string}
             */
            status: "draft" | "published";
            /** Tags */
            tags: components["schemas"]["TagPublicOut"][];
            /** Text */
            text: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
            /** Version */
            version: number;
        };
        /**
         * MomentCreateIn
         * @description 新建草稿。草稿可以暂时没有图片、替代文本也可以发布前补齐（03 §5）。
         */
        MomentCreateIn: {
            /** Images */
            images?: components["schemas"]["MomentImageIn"][];
            /** Tags */
            tags?: string[];
            /**
             * Text
             * @default
             */
            text: string;
        };
        /**
         * MomentImageAdminOut
         * @description 可直接回填到 `MomentUpdateIn.images` 的形状（只有三个写入字段）。
         */
        MomentImageAdminOut: {
            /** Alt */
            alt: string;
            /**
             * Media Id
             * Format: uuid
             */
            media_id: string;
            /** Position */
            position: number;
        };
        /**
         * MomentImageIn
         * @description 一张图的引用。`position` 必须从 0 开始连续且不重复。
         */
        MomentImageIn: {
            /** Alt */
            alt: string;
            /**
             * Media Id
             * Format: uuid
             */
            media_id: string;
            /** Position */
            position: number;
        };
        /** MomentImageOut */
        MomentImageOut: {
            /** Alt */
            alt: string;
            /** Height */
            height: number;
            /**
             * Media Id
             * Format: uuid
             */
            media_id: string;
            /** Position */
            position: number;
            /** Variants */
            variants: components["schemas"]["MediaVariantOut"][];
            /** Width */
            width: number;
        };
        /**
         * MomentListOut
         * @description 列表统一结构（05 §6）：`{items, next_cursor}`。
         */
        MomentListOut: {
            /** Items */
            items: components["schemas"]["MomentOut"][];
            /** Next Cursor */
            next_cursor: string | null;
        };
        /** MomentOut */
        MomentOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Images */
            images: components["schemas"]["MomentImageOut"][];
            /** Published At */
            published_at: string | null;
            /** Tags */
            tags: components["schemas"]["TagPublicOut"][];
            /** Text */
            text: string;
        };
        /**
         * MomentUpdateIn
         * @description 更新。所有字段可选；传入 `images` 时**完整替换**有序关系（05 §7）。
         */
        MomentUpdateIn: {
            /** Images */
            images?: components["schemas"]["MomentImageIn"][] | null;
            /** Tags */
            tags?: string[] | null;
            /** Text */
            text?: string | null;
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
         * ReviewRefOut
         * @description 可选长评引用（只给公开文章的对外字段）。
         */
        ReviewRefOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Slug */
            slug: string;
            /** Title */
            title: string;
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
    admin_list_links_api_v1_admin_friends_get: {
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
                    "application/json": components["schemas"]["FriendLinkAdminListOut"];
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
    admin_create_link_api_v1_admin_friends_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FriendLinkCreateIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FriendLinkAdminOut"];
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
    admin_read_link_api_v1_admin_friends__link_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                link_id: string;
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
                    "application/json": components["schemas"]["FriendLinkAdminOut"];
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
    admin_delete_link_api_v1_admin_friends__link_id__delete: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                link_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["FriendLinkActionIn"] | null;
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
    admin_update_link_api_v1_admin_friends__link_id__patch: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                link_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FriendLinkUpdateIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FriendLinkAdminOut"];
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
    admin_publish_link_api_v1_admin_friends__link_id__publish_post: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                link_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["FriendLinkActionIn"] | null;
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FriendLinkAdminOut"];
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
    admin_unpublish_link_api_v1_admin_friends__link_id__unpublish_post: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                link_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["FriendLinkActionIn"] | null;
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FriendLinkAdminOut"];
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
    admin_list_entries_api_v1_admin_journal_entries_get: {
        parameters: {
            query?: {
                status?: ("draft" | "published") | null;
                visibility?: ("private" | "public") | null;
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
                    "application/json": components["schemas"]["JournalAdminListOut"];
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
    admin_create_entry_api_v1_admin_journal_entries_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["JournalCreateIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JournalAdminOut"];
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
    admin_read_entry_api_v1_admin_journal_entries__entry_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                entry_id: string;
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
                    "application/json": components["schemas"]["JournalAdminOut"];
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
    admin_delete_entry_api_v1_admin_journal_entries__entry_id__delete: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                entry_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["JournalVisibilityIn"] | null;
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
    admin_update_entry_api_v1_admin_journal_entries__entry_id__patch: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                entry_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["JournalUpdateIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JournalAdminOut"];
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
    admin_publish_entry_api_v1_admin_journal_entries__entry_id__publish_post: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                entry_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["JournalVisibilityIn"] | null;
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JournalAdminOut"];
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
    admin_unpublish_entry_api_v1_admin_journal_entries__entry_id__unpublish_post: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                entry_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["JournalVisibilityIn"] | null;
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JournalAdminOut"];
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
    admin_set_visibility_api_v1_admin_journal_entries__entry_id__visibility_post: {
        parameters: {
            query: {
                visibility: "private" | "public";
            };
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                entry_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["JournalVisibilityIn"] | null;
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JournalAdminOut"];
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
    admin_list_entries_api_v1_admin_leisure_entries_get: {
        parameters: {
            query?: {
                kind?: string | null;
                status?: ("draft" | "published") | null;
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
                    "application/json": components["schemas"]["LeisureAdminListOut"];
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
    admin_create_entry_api_v1_admin_leisure_entries_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LeisureCreateIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LeisureAdminOut"];
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
    admin_read_entry_api_v1_admin_leisure_entries__entry_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                entry_id: string;
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
                    "application/json": components["schemas"]["LeisureAdminOut"];
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
    admin_delete_entry_api_v1_admin_leisure_entries__entry_id__delete: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                entry_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["LeisureActionIn"] | null;
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
    admin_update_entry_api_v1_admin_leisure_entries__entry_id__patch: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                entry_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LeisureUpdateIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LeisureAdminOut"];
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
    admin_publish_entry_api_v1_admin_leisure_entries__entry_id__publish_post: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                entry_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["LeisureActionIn"] | null;
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LeisureAdminOut"];
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
    admin_unpublish_entry_api_v1_admin_leisure_entries__entry_id__unpublish_post: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                entry_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["LeisureActionIn"] | null;
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LeisureAdminOut"];
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
    list_admin_moments_api_v1_admin_moments_get: {
        parameters: {
            query?: {
                status?: string | null;
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
                    "application/json": components["schemas"]["MomentAdminListOut"];
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
    create_moment_api_v1_admin_moments_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MomentCreateIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MomentAdminOut"];
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
    read_admin_moment_api_v1_admin_moments__moment_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                moment_id: string;
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
                    "application/json": components["schemas"]["MomentAdminOut"];
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
    delete_moment_api_v1_admin_moments__moment_id__delete: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                moment_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
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
    update_moment_api_v1_admin_moments__moment_id__patch: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                moment_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MomentUpdateIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MomentAdminOut"];
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
    publish_moment_api_v1_admin_moments__moment_id__publish_post: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                moment_id: string;
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
                    "application/json": components["schemas"]["MomentAdminOut"];
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
    unpublish_moment_api_v1_admin_moments__moment_id__unpublish_post: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                moment_id: string;
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
                    "application/json": components["schemas"]["MomentAdminOut"];
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
    list_links_api_v1_coop_links_get: {
        parameters: {
            query?: {
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
                    "application/json": components["schemas"]["FriendLinkListOut"];
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
    read_link_api_v1_coop_links__link_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                link_id: string;
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
                    "application/json": components["schemas"]["FriendLinkDetailOut"];
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
    list_tags_api_v1_coop_tags_get: {
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
                    "application/json": components["schemas"]["FriendTagListOut"];
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
    read_calendar_api_v1_journal_calendar_get: {
        parameters: {
            query?: {
                year?: number | null;
                month?: number | null;
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
                    "application/json": components["schemas"]["JournalCalendarOut"];
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
    list_entries_api_v1_journal_entries_get: {
        parameters: {
            query?: {
                year?: number | null;
                month?: number | null;
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
                    "application/json": components["schemas"]["JournalEntryListOut"];
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
    read_entry_api_v1_journal_entries__entry_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                entry_id: string;
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
                    "application/json": components["schemas"]["JournalEntryDetailOut"];
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
    list_entries_api_v1_leisure_entries_get: {
        parameters: {
            query?: {
                kind?: string | null;
                progress?: string | null;
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
                    "application/json": components["schemas"]["LeisureListOut"];
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
    read_entry_api_v1_leisure_entries__entry_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                entry_id: string;
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
                    "application/json": components["schemas"]["LeisureEntryOut"];
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
    list_moments_api_v1_moments_get: {
        parameters: {
            query?: {
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
                    "application/json": components["schemas"]["MomentListOut"];
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
    read_moment_api_v1_moments__moment_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                moment_id: string;
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
                    "application/json": components["schemas"]["MomentOut"];
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
