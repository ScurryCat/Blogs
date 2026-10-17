/**
 * 本文件由 `npm run gen:api` 生成，请勿手工修改。
 * 来源：contracts/openapi.json（apps/api/scripts/export_openapi.py 生成）。
 */

export interface paths {
    "/api/v1/admin/albums": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 管理列表（含草稿） */
        get: operations["list_admin_albums_api_v1_admin_albums_get"];
        put?: never;
        /** 新建相册草稿 */
        post: operations["create_album_api_v1_admin_albums_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/albums/{album_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 读取相册（草稿 / 预览） */
        get: operations["read_admin_album_api_v1_admin_albums__album_id__get"];
        put?: never;
        post?: never;
        /** 软删除相册 */
        delete: operations["delete_album_api_v1_admin_albums__album_id__delete"];
        options?: never;
        head?: never;
        /** 更新相册 */
        patch: operations["update_album_api_v1_admin_albums__album_id__patch"];
        trace?: never;
    };
    "/api/v1/admin/albums/{album_id}/photos/{media_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * 从相册移除一张照片（单处撤回）
         * @description **只移除这一处引用**。返回 204；该媒体仍被其他公开内容引用时继续匿名可读。
         *
         *     媒体本身（文件与 `media` 行）不动：它可能还被动态、作品或另一个相册引用
         *     （05 §11：「管理端应提示，而不是声称一次撤回收回所有副本」）。
         */
        delete: operations["remove_album_photo_api_v1_admin_albums__album_id__photos__media_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/albums/{album_id}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 发布相册 */
        post: operations["publish_album_api_v1_admin_albums__album_id__publish_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/albums/{album_id}/unpublish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 撤回相册 */
        post: operations["unpublish_album_api_v1_admin_albums__album_id__unpublish_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/exploration/records": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 管理列表（含草稿） */
        get: operations["list_admin_records_api_v1_admin_exploration_records_get"];
        put?: never;
        /** 新建草稿 */
        post: operations["create_record_api_v1_admin_exploration_records_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/exploration/records/{record_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 读取问题记录（草稿 / 预览） */
        get: operations["read_admin_record_api_v1_admin_exploration_records__record_id__get"];
        put?: never;
        post?: never;
        /** 软删除问题记录 */
        delete: operations["delete_record_api_v1_admin_exploration_records__record_id__delete"];
        options?: never;
        head?: never;
        /** 更新问题记录 */
        patch: operations["update_record_api_v1_admin_exploration_records__record_id__patch"];
        trace?: never;
    };
    "/api/v1/admin/exploration/records/{record_id}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 发布问题记录 */
        post: operations["publish_record_api_v1_admin_exploration_records__record_id__publish_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/exploration/records/{record_id}/unpublish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 撤回问题记录 */
        post: operations["unpublish_record_api_v1_admin_exploration_records__record_id__unpublish_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
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
    "/api/v1/admin/messaging/overview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 运行配置与今日用量（成本不隐藏）
         * @description 给站主看的真实数字：今天到底花了多少单位、有多少会话与消息。
         *
         *     `config` 走 `safe_summary()`，密钥只以「是否设置」出现。
         */
        get: operations["admin_overview_api_v1_admin_messaging_overview_get"];
        put?: never;
        post?: never;
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
    "/api/v1/admin/projects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 管理列表（含草稿） */
        get: operations["list_admin_projects_api_v1_admin_projects_get"];
        put?: never;
        /** 新建草稿 */
        post: operations["create_project_api_v1_admin_projects_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/projects/{project_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 读取作品（草稿 / 预览） */
        get: operations["read_admin_project_api_v1_admin_projects__project_id__get"];
        put?: never;
        post?: never;
        /** 软删除作品 */
        delete: operations["delete_project_api_v1_admin_projects__project_id__delete"];
        options?: never;
        head?: never;
        /** 更新作品 */
        patch: operations["update_project_api_v1_admin_projects__project_id__patch"];
        trace?: never;
    };
    "/api/v1/admin/projects/{project_id}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 发布作品 */
        post: operations["publish_project_api_v1_admin_projects__project_id__publish_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/projects/{project_id}/unpublish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 撤回作品 */
        post: operations["unpublish_project_api_v1_admin_projects__project_id__unpublish_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/skills": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 管理列表（含草稿） */
        get: operations["list_admin_skills_api_v1_admin_skills_get"];
        put?: never;
        /** 新建草稿 */
        post: operations["create_skill_api_v1_admin_skills_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/skills/{skill_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 读取技能（草稿 / 预览） */
        get: operations["read_admin_skill_api_v1_admin_skills__skill_id__get"];
        put?: never;
        post?: never;
        /** 软删除技能 */
        delete: operations["delete_skill_api_v1_admin_skills__skill_id__delete"];
        options?: never;
        head?: never;
        /** 更新技能 */
        patch: operations["update_skill_api_v1_admin_skills__skill_id__patch"];
        trace?: never;
    };
    "/api/v1/admin/skills/{skill_id}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 发布技能 */
        post: operations["publish_skill_api_v1_admin_skills__skill_id__publish_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/skills/{skill_id}/unpublish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 撤回技能 */
        post: operations["unpublish_skill_api_v1_admin_skills__skill_id__unpublish_post"];
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
    "/api/v1/exploration/records": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 公开问题记录列表 */
        get: operations["list_records_api_v1_exploration_records_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/exploration/records/stats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 公开工作状态统计
         * @description 只统计**当前公开**的记录：与列表里能看到的条数完全一致。
         *
         *     草稿不参与统计，因此读者不会从「待探索 3 / 已解决 1」里推断出
         *     「站主还藏了几条没发布的问题」（验收 3）。
         */
        get: operations["read_stats_api_v1_exploration_records_stats_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/exploration/records/{slug}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 公开问题记录详情 */
        get: operations["read_record_api_v1_exploration_records__slug__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/gallery/albums": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 公开相册列表 */
        get: operations["list_albums_api_v1_gallery_albums_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/gallery/albums/{slug}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 公开相册详情 */
        get: operations["read_album_api_v1_gallery_albums__slug__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/gallery/photos": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 照片墙（跨相册 / 单相册） */
        get: operations["list_photos_api_v1_gallery_photos_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/gallery/photos/years": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 照片墙可用的年份 */
        get: operations["list_photo_years_api_v1_gallery_photos_years_get"];
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
    "/api/v1/messaging/characters": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 角色目录（含当前访客自己的会话摘要）
         * @description 没有会话时摘要是 `null` —— 不会替访客凭空造一段会话。
         */
        get: operations["list_characters_api_v1_messaging_characters_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/messaging/conversations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 取得或创建某角色的会话
         * @description 按角色 id 取得会话。**同一角色只会有一段会话**，两个标签页共用同一顺序。
         */
        post: operations["create_conversation_api_v1_messaging_conversations_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/messaging/conversations/{conversation_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 读取会话 */
        get: operations["read_conversation_api_v1_messaging_conversations__conversation_id__get"];
        put?: never;
        post?: never;
        /** 清除这段会话 */
        delete: operations["delete_conversation_api_v1_messaging_conversations__conversation_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/messaging/conversations/{conversation_id}/choice": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 选择一个预设选项
         * @description 非法或过期的选项**不会推进剧情**：422（选项不属于当前节点）/ 409（节点版本过期）。
         */
        post: operations["choose_option_api_v1_messaging_conversations__conversation_id__choice_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/messaging/conversations/{conversation_id}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 自由输入（调用 AI 适配层）
         * @description 幂等键是 `client_request_id`（作用域 = 当前访客会话）。重试不会重复调用上游。
         */
        post: operations["send_message_api_v1_messaging_conversations__conversation_id__messages_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/messaging/conversations/{conversation_id}/restart": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 重开这段剧情（保留聊天记录） */
        post: operations["restart_story_api_v1_messaging_conversations__conversation_id__restart_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/messaging/conversations/{conversation_id}/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 回到话题
         * @description 恢复被暂停的节点与它的选项；重复调用是幂等的空操作。
         */
        post: operations["resume_topic_api_v1_messaging_conversations__conversation_id__resume_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/messaging/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 建立或续期访客会话
         * @description 第一次调用会建立匿名会话（HttpOnly Cookie，库里只有摘要）。
         *
         *     这是**唯一**需要「先有会话才有 CSRF token」的引导接口，因此它只做来源校验，
         *     不要求 token（还没有 token 可带）。跨站页面会被来源校验挡掉。
         */
        post: operations["ensure_session_api_v1_messaging_session_post"];
        /**
         * 立即清除该访客的全部角色消息
         * @description 「访客可以立即清除聊天」（08 §7）。
         *
         *     全站日预算计数**不**因此回退：已经产生的上游成本仍然如实保留（08 §7）。
         *
         *     清除 Cookie 写在**返回的那个** Response 上：FastAPI 会合并注入的 response 与
         *     返回值的头，但依赖合并顺序迟早会咬人，这里直接构造、直接返回，行为可断言。
         */
        delete: operations["clear_session_api_v1_messaging_session_delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/messaging/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 角色消息的运行状态与限额
         * @description **无副作用**：不建会话、不发 Cookie、不读访客身份。
         *
         *     因此它可以被健康探针、管理页与首屏同时调用，也不会因为预取而产生垃圾会话。
         */
        get: operations["read_status_api_v1_messaging_status_get"];
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
    "/api/v1/projects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 公开作品列表 */
        get: operations["list_projects_api_v1_projects_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{slug}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 公开作品详情 */
        get: operations["read_project_api_v1_projects__slug__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/skills": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 技能全书列表 */
        get: operations["list_skills_api_v1_skills_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/skills/combo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 「合体」：两个技能的交集作品
         * @description 「合体」筛选（07 §6）。
         *
         *     三种业务结果是**分开**的，不混成一种：
         *
         *       1. 技能 A 或 B 不存在 / 未发布 → 404（对外统一「技能不存在或未公开」）；
         *       2. A 与 B 是同一个技能 → 422（明确报错，不把全部作品冒充合体结果）；
         *       3. 两个技能都公开但**没有交集** → 200，`items` 为空 + `note` 说明，
         *          不用 AI 编造一件新作品（任务卡执行清单）。
         */
        get: operations["read_combo_api_v1_skills_combo_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/skills/projects/{slug}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 某件公开作品使用的公开技能
         * @description 作品详情「使用的技能」的数据入口（验收 2 的同一关系来源）。
         *
         *     作品本身不公开（草稿 / 撤回 / 已删除 / 不存在）时返回 404 ——
         *     绝不能靠这个端点反查一件还没发布的作品的技能。
         */
        get: operations["read_skills_for_project_api_v1_skills_projects__slug__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/skills/{slug}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 技能详情 */
        get: operations["read_skill_api_v1_skills__slug__get"];
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
         * AiStateOut
         * @description AI 侧的状态。`status` 是稳定机器码；`message` 是给人看的原因。
         */
        AiStateOut: {
            /** Message */
            message: string;
            /** Provider */
            provider: string;
            /**
             * Retryable
             * @default false
             */
            retryable: boolean;
            /** Status */
            status: string;
        };
        /** AlbumAdminListOut */
        AlbumAdminListOut: {
            /** Items */
            items: components["schemas"]["AlbumAdminOut"][];
            /** Next Cursor */
            next_cursor: string | null;
        };
        /** AlbumAdminOut */
        AlbumAdminOut: {
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Description */
            description: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Kind */
            kind: string;
            /** Kind Label */
            kind_label: string;
            /** Photo Count */
            photo_count: number;
            /** Photos */
            photos: components["schemas"]["PhotoAdminOut"][];
            /** Position */
            position: number;
            /** Published At */
            published_at: string | null;
            /** Slug */
            slug: string;
            /** Status */
            status: string;
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
        /** AlbumCreateIn */
        AlbumCreateIn: {
            /** Csrf Token */
            csrf_token?: string | null;
            /**
             * Description
             * @default
             */
            description: string;
            /**
             * Kind
             * @default photo
             * @enum {string}
             */
            kind: "photo" | "screenshot" | "other";
            /** Photos */
            photos?: components["schemas"]["AlbumPhotoIn"][];
            /**
             * Position
             * @default 0
             */
            position: number;
            /** Slug */
            slug: string;
            /** Title */
            title: string;
        };
        /** AlbumDetailOut */
        AlbumDetailOut: {
            cover: components["schemas"]["PhotoOut"] | null;
            /** Description */
            description: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Kind */
            kind: string;
            /** Kind Label */
            kind_label: string;
            /** Photo Count */
            photo_count: number;
            /** Photos */
            photos: components["schemas"]["PhotoOut"][];
            /**
             * Published At
             * Format: date-time
             */
            published_at: string;
            /** Slug */
            slug: string;
            /** Title */
            title: string;
        };
        /** AlbumListOut */
        AlbumListOut: {
            /** Items */
            items: components["schemas"]["AlbumSummaryOut"][];
            /** Next Cursor */
            next_cursor: string | null;
        };
        /**
         * AlbumPhotoIn
         * @description 相册里的一张照片。`media_id` 必须是**已有**媒体（复用，不重复上传 —— 07 §5）。
         */
        AlbumPhotoIn: {
            /** Alt */
            alt: string;
            /**
             * Caption
             * @default
             */
            caption: string;
            /**
             * Media Id
             * Format: uuid
             */
            media_id: string;
            /** Position */
            position: number;
            /** Taken On */
            taken_on?: string | null;
        };
        /** AlbumSummaryOut */
        AlbumSummaryOut: {
            cover: components["schemas"]["PhotoOut"] | null;
            /** Description */
            description: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Kind */
            kind: string;
            /** Kind Label */
            kind_label: string;
            /** Photo Count */
            photo_count: number;
            /**
             * Published At
             * Format: date-time
             */
            published_at: string;
            /** Slug */
            slug: string;
            /** Title */
            title: string;
        };
        /**
         * AlbumUpdateIn
         * @description PATCH：只改出现过的字段。`slug` 不可改（公开 URL 稳定优先）。
         */
        AlbumUpdateIn: {
            /** Csrf Token */
            csrf_token?: string | null;
            /** Description */
            description?: string | null;
            /** Kind */
            kind?: ("photo" | "screenshot" | "other") | null;
            /** Photos */
            photos?: components["schemas"]["AlbumPhotoIn"][] | null;
            /** Position */
            position?: number | null;
            /** Title */
            title?: string | null;
        };
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
         * CardOut
         * @description 服务端验证过的站内内容引用。`url` 由服务端生成，前端只用它渲染 SiteLink。
         */
        CardOut: {
            /** Id */
            id: string;
            /** Kind */
            kind: string;
            /** Summary */
            summary: string;
            /** Title */
            title: string;
            /** Url */
            url: string;
        };
        /** CharacterOut */
        CharacterOut: {
            /** Avatar */
            avatar: string;
            /** Avatar Alt */
            avatar_alt: string;
            conversation?: components["schemas"]["ConversationSummaryOut"] | null;
            /** Handle */
            handle: string;
            /** Id */
            id: string;
            /** Name */
            name: string;
            /** Story Id */
            story_id: string;
            /** Story Version */
            story_version: string;
            /** Tagline */
            tagline: string;
        };
        /** ChoiceIn */
        ChoiceIn: {
            /** Choice Id */
            choice_id: string;
            /** Client Message Id */
            client_message_id: string;
            /** Csrf Token */
            csrf_token?: string | null;
            /** Node Id */
            node_id: string;
            /** Node Version */
            node_version: number;
        };
        /** ChoiceOut */
        ChoiceOut: {
            /** Id */
            id: string;
            /** Label */
            label: string;
        };
        /** ConversationCreateIn */
        ConversationCreateIn: {
            /** Character Id */
            character_id: string;
            /** Csrf Token */
            csrf_token?: string | null;
        };
        /** ConversationOut */
        ConversationOut: {
            ai: components["schemas"]["AiStateOut"];
            conversation: components["schemas"]["ConversationStateOut"];
            /** Messages */
            messages?: components["schemas"]["MessageOut"][];
            node?: components["schemas"]["NodeOut"] | null;
            usage: components["schemas"]["UsageOut"];
        };
        /** ConversationStateOut */
        ConversationStateOut: {
            /** Can Restart */
            can_restart: boolean;
            /** Can Resume */
            can_resume: boolean;
            /** Can Send */
            can_send: boolean;
            /** Character Id */
            character_id: string;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Expires At
             * Format: date-time
             */
            expires_at: string;
            /** Id */
            id: string;
            /** Node Id */
            node_id: string;
            /** Node Version */
            node_version: number;
            /** Paused Node Id */
            paused_node_id?: string | null;
            /** Status */
            status: string;
            /** Story Id */
            story_id: string;
            /** Story Version */
            story_version: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /**
         * ConversationSummaryOut
         * @description 角色列表里的会话摘要。**只属于当前访客**；没有会话时为 null。
         */
        ConversationSummaryOut: {
            /**
             * Expires At
             * Format: date-time
             */
            expires_at: string;
            /** Id */
            id: string;
            /** Last Message At */
            last_message_at?: string | null;
            /** Message Count */
            message_count: number;
            /** Node Id */
            node_id: string;
            /** Node Version */
            node_version: number;
            /**
             * Preview
             * @default
             */
            preview: string;
            /** Status */
            status: string;
        };
        /**
         * EvidenceLinkIn
         * @description 一条结果 / 验证链接。只接受 http / https。
         */
        EvidenceLinkIn: {
            /**
             * Kind
             * @default proof
             * @enum {string}
             */
            kind: "repo" | "demo" | "docs" | "proof" | "other";
            /** Label */
            label: string;
            /** Url */
            url: string;
        };
        /** EvidenceLinkOut */
        EvidenceLinkOut: {
            /** Kind */
            kind: string;
            /** Label */
            label: string;
            /** Url */
            url: string;
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
        /** LimitsOut */
        LimitsOut: {
            /** Conversation Idle Seconds */
            conversation_idle_seconds: number;
            /** Conversation Max Inflight */
            conversation_max_inflight: number;
            /** Input Max Codepoints */
            input_max_codepoints: number;
            /** Max Bubbles */
            max_bubbles: number;
            /** Site Daily Units */
            site_daily_units: number;
            /** Site Max Concurrency */
            site_max_concurrency: number;
            /** Visitor Daily Requests */
            visitor_daily_requests: number;
            /** Visitor Session Idle Seconds */
            visitor_session_idle_seconds: number;
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
        /** MessageIn */
        MessageIn: {
            /** Client Request Id */
            client_request_id: string;
            /** Csrf Token */
            csrf_token?: string | null;
            /** Text */
            text: string;
        };
        /** MessageOut */
        MessageOut: {
            /**
             * Attribution
             * @default
             */
            attribution: string;
            /** Cards */
            cards?: components["schemas"]["CardOut"][];
            /** Choice Id */
            choice_id?: string | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Generation Request Id */
            generation_request_id?: string | null;
            /** Id */
            id: string;
            /**
             * Is Ai
             * @default false
             */
            is_ai: boolean;
            /** Node Id */
            node_id?: string | null;
            /** Origin */
            origin: string;
            /** Seq */
            seq: number;
            /** Text */
            text: string;
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
            /** Album Links */
            album_links?: components["schemas"]["MomentAlbumLinkOut"][];
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
         * MomentAlbumLinkIn
         * @description 「同时收录到相册」的一条选择：目标相册 + 本条动态里的图片。
         *
         *     语义（任务书 §4.3）：传 `album_links` 时是**完整选择**；`[]` 表示清空；
         *     不传表示保留原配置（但服务端会清掉已不属于该动态的图片配置）。
         *     `media_ids` 必须是「本条动态当前图片」的子集；非法相册 / 媒体由服务端返回 409。
         */
        MomentAlbumLinkIn: {
            /**
             * Album Id
             * Format: uuid
             */
            album_id: string;
            /** Media Ids */
            media_ids?: string[];
        };
        /**
         * MomentAlbumLinkOut
         * @description 管理回执里的当前收录选择：`{album_id, media_ids[]}`。
         *
         *     相册按 `(position ASC, id ASC)`；`media_ids` 按动态图片 position 升序。
         *     草稿 / 撤回状态下也照实返回（配置存在 ≠ 公开资格）。
         */
        MomentAlbumLinkOut: {
            /**
             * Album Id
             * Format: uuid
             */
            album_id: string;
            /** Media Ids */
            media_ids: string[];
        };
        /**
         * MomentCreateIn
         * @description 新建草稿。草稿可以暂时没有图片、替代文本也可以发布前补齐（03 §5）。
         */
        MomentCreateIn: {
            /** Album Links */
            album_links?: components["schemas"]["MomentAlbumLinkIn"][];
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
         *
         *     `album_links` 的「不传」与「传 []」语义不同（任务书 §4.3）：
         *     不传 = 保留原收录配置；[] = 清空该动态全部收录选择。
         */
        MomentUpdateIn: {
            /** Album Links */
            album_links?: components["schemas"]["MomentAlbumLinkIn"][] | null;
            /** Images */
            images?: components["schemas"]["MomentImageIn"][] | null;
            /** Tags */
            tags?: string[] | null;
            /** Text */
            text?: string | null;
        };
        /**
         * NodeOut
         * @description 当前剧情节点的**可交互部分**。
         *
         *     台词不在这里重复下发 —— 它们已经作为消息存在于 `messages` 里，
         *     再次下发会让「恢复后不重复插入已经展示过的开场」变得无法断言（08 §3）。
         */
        NodeOut: {
            /** Choices */
            choices?: components["schemas"]["ChoiceOut"][];
            /** Ending */
            ending: boolean;
            /** Id */
            id: string;
            /** Resumable */
            resumable: boolean;
            /** Resume Text */
            resume_text?: string | null;
        };
        /** NodeVersionIn */
        NodeVersionIn: {
            /** Csrf Token */
            csrf_token?: string | null;
            /** Node Version */
            node_version: number;
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
        /**
         * PhotoAdminOut
         * @description 管理回执：额外给出媒体状态与收录来源，让表单能提示「这张图还不能发布」/「来自动态」。
         */
        PhotoAdminOut: {
            /** Album Id */
            album_id?: string | null;
            /** Album Slug */
            album_slug?: string | null;
            /** Album Title */
            album_title?: string | null;
            /** Alt */
            alt: string;
            /** Caption */
            caption: string;
            /** Height */
            height: number;
            /**
             * Media Deleted
             * @default false
             */
            media_deleted: boolean;
            /**
             * Media Id
             * Format: uuid
             */
            media_id: string;
            /**
             * Media Status
             * @default ready
             */
            media_status: string;
            /** Position */
            position: number;
            /** Sources */
            sources?: components["schemas"]["PhotoSourceOut"][];
            /** Taken On */
            taken_on: string | null;
            /** Variants */
            variants: components["schemas"]["MediaVariantOut"][];
            /** Width */
            width: number;
        };
        /**
         * PhotoItemOut
         * @description 照片墙上的一项：照片 + **它属于哪个相册**。
         *
         *     为什么把相册信息放在每一项里而不是让前端按相册再查一次：跨相册的照片墙是
         *     「相册 + 照片顺序」的混合排序，前端需要能就地渲染分组标题；再查一次相册
         *     会产生 N+1，也会让「同一张图属于两个相册」这种真实情况无法表达。
         */
        PhotoItemOut: {
            album: components["schemas"]["WallAlbumOut"];
            photo: components["schemas"]["PhotoOut"];
        };
        /**
         * PhotoListOut
         * @description 照片墙的扁平列表。`total` 是当前筛选下的实时总张数，不作为权限条件。
         */
        PhotoListOut: {
            /** Items */
            items: components["schemas"]["PhotoItemOut"][];
            /** Next Cursor */
            next_cursor: string | null;
            /** Total */
            total: number;
        };
        /**
         * PhotoOut
         * @description 一张照片的公开形态：关系字段 + 媒体尺寸 + 可用变体（**不含原图**）。
         */
        PhotoOut: {
            /** Alt */
            alt: string;
            /** Caption */
            caption: string;
            /** Height */
            height: number;
            /**
             * Media Id
             * Format: uuid
             */
            media_id: string;
            /** Position */
            position: number;
            /** Taken On */
            taken_on: string | null;
            /** Variants */
            variants: components["schemas"]["MediaVariantOut"][];
            /** Width */
            width: number;
        };
        /**
         * PhotoSourceOut
         * @description 一张相册照片的收录来源（管理端回执用；公开 DTO 不暴露来源）。
         *
         *     - `independent`：相册管理端显式收录（迁移回填的旧图片也是这一种）；
         *     - `moment`：由某条动态的「同时收录到相册」带来；`moment_id` 给出动态 ID。
         *       **配置存在不等于公开资格**：动态草稿 / 撤回时这一条仍然存在，但不贡献公开资格。
         */
        PhotoSourceOut: {
            /**
             * Kind
             * @enum {string}
             */
            kind: "independent" | "moment";
            /** Moment Id */
            moment_id?: string | null;
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
         * ProjectAdminImageOut
         * @description 管理回执：额外给出媒体状态，让表单能提示「这张图还不能发布」。
         */
        ProjectAdminImageOut: {
            /** Alt */
            alt: string;
            /** Caption */
            caption: string;
            /** Height */
            height: number;
            /** Kind */
            kind: string;
            /**
             * Media Deleted
             * @default false
             */
            media_deleted: boolean;
            /**
             * Media Id
             * Format: uuid
             */
            media_id: string;
            /**
             * Media Status
             * @default ready
             */
            media_status: string;
            /** Position */
            position: number;
            /** Taken On */
            taken_on: string | null;
            /** Variants */
            variants: components["schemas"]["MediaVariantOut"][];
            /** Width */
            width: number;
        };
        /** ProjectAdminListOut */
        ProjectAdminListOut: {
            /** Items */
            items: components["schemas"]["ProjectAdminOut"][];
            /** Next Cursor */
            next_cursor: string | null;
        };
        /** ProjectAdminOut */
        ProjectAdminOut: {
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
            images: components["schemas"]["ProjectAdminImageOut"][];
            /** Links */
            links: components["schemas"]["ProjectLinkOut"][];
            /** Maintenance */
            maintenance: string;
            /** Maintenance Label */
            maintenance_label: string;
            /** Outcomes */
            outcomes: string;
            /** Palace Id */
            palace_id: string | null;
            /** Problem */
            problem: string;
            /** Published At */
            published_at: string | null;
            /** Role */
            role: string;
            /** Slug */
            slug: string;
            /** Status */
            status: string;
            /** Summary */
            summary: string;
            /** Tech Stack */
            tech_stack: string[];
            /** Title */
            title: string;
            /** Tradeoffs */
            tradeoffs: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
            /** Version */
            version: number;
        };
        /** ProjectCreateIn */
        ProjectCreateIn: {
            /** Images */
            images?: components["schemas"]["ProjectImageIn"][];
            /** Links */
            links?: components["schemas"]["ProjectLinkIn"][];
            /**
             * Maintenance
             * @default maintained
             * @enum {string}
             */
            maintenance: "active" | "maintained" | "paused" | "archived";
            /**
             * Outcomes
             * @default
             */
            outcomes: string;
            /** Palace Id */
            palace_id?: string | null;
            /**
             * Problem
             * @default
             */
            problem: string;
            /**
             * Role
             * @default
             */
            role: string;
            /** Slug */
            slug: string;
            /**
             * Summary
             * @default
             */
            summary: string;
            /** Tech Stack */
            tech_stack?: string[];
            /** Title */
            title: string;
            /**
             * Tradeoffs
             * @default
             */
            tradeoffs: string;
        };
        /**
         * ProjectDetailOut
         * @description 公开详情（07 §5：「这个作品回答了『你做出了什么』」）。
         */
        ProjectDetailOut: {
            cover: components["schemas"]["ProjectImageOut"] | null;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Images */
            images: components["schemas"]["ProjectImageOut"][];
            /** Links */
            links: components["schemas"]["ProjectLinkOut"][];
            /** Maintenance */
            maintenance: string;
            /** Maintenance Label */
            maintenance_label: string;
            /** Outcomes */
            outcomes: string;
            palace: components["schemas"]["ProjectPalaceLinkOut"] | null;
            /** Problem */
            problem: string;
            /**
             * Published At
             * Format: date-time
             */
            published_at: string;
            /** Role */
            role: string;
            /** Slug */
            slug: string;
            /** Summary */
            summary: string;
            /** Tech Stack */
            tech_stack: string[];
            /** Title */
            title: string;
            /** Tradeoffs */
            tradeoffs: string;
        };
        /**
         * ProjectImageIn
         * @description 一张作品图片。`media_id` 必须是**已有**媒体（复用，不重复上传 —— 07 §5）。
         */
        ProjectImageIn: {
            /** Alt */
            alt: string;
            /**
             * Caption
             * @default
             */
            caption: string;
            /**
             * Kind
             * @default detail
             * @enum {string}
             */
            kind: "cover" | "detail" | "evidence";
            /**
             * Media Id
             * Format: uuid
             */
            media_id: string;
            /** Position */
            position: number;
            /** Taken On */
            taken_on?: string | null;
        };
        /**
         * ProjectImageOut
         * @description 公开图片：只给可用变体与尺寸，不给服务器路径或原图。
         */
        ProjectImageOut: {
            /** Alt */
            alt: string;
            /** Caption */
            caption: string;
            /** Height */
            height: number;
            /** Kind */
            kind: string;
            /**
             * Media Id
             * Format: uuid
             */
            media_id: string;
            /** Position */
            position: number;
            /** Taken On */
            taken_on: string | null;
            /** Variants */
            variants: components["schemas"]["MediaVariantOut"][];
            /** Width */
            width: number;
        };
        /** ProjectLinkIn */
        ProjectLinkIn: {
            /**
             * Kind
             * @enum {string}
             */
            kind: "repo" | "demo" | "docs" | "other";
            /** Label */
            label: string;
            /** Url */
            url: string;
        };
        /** ProjectLinkOut */
        ProjectLinkOut: {
            /** Kind */
            kind: string;
            /** Label */
            label: string;
            /** Url */
            url: string;
        };
        /** ProjectListOut */
        ProjectListOut: {
            /** Items */
            items: components["schemas"]["ProjectSummaryOut"][];
            /** Next Cursor */
            next_cursor: string | null;
        };
        /**
         * ProjectPalaceLinkOut
         * @description 作品详情「攻略记录」用的专题链接。
         *
         *     只包含 slug 与标题 —— 且**只在专题当前公开时**由 service 填值；专题撤回后这里是
         *     `None`，页面显示「暂时没有可读的攻略记录」，绝不露出隐藏专题的标题（验收 5）。
         */
        ProjectPalaceLinkOut: {
            /** Slug */
            slug: string;
            /** Summary */
            summary: string;
            /** Title */
            title: string;
        };
        /**
         * ProjectSummaryOut
         * @description 公开摘要（列表卡片）。`palace` 只在专题**当前公开**时才出现。
         */
        ProjectSummaryOut: {
            cover: components["schemas"]["ProjectImageOut"] | null;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Maintenance */
            maintenance: string;
            /** Maintenance Label */
            maintenance_label: string;
            palace: components["schemas"]["ProjectPalaceLinkOut"] | null;
            /**
             * Published At
             * Format: date-time
             */
            published_at: string;
            /** Slug */
            slug: string;
            /** Summary */
            summary: string;
            /** Tech Stack */
            tech_stack: string[];
            /** Title */
            title: string;
        };
        /**
         * ProjectUpdateIn
         * @description PATCH：只改出现过的字段。`slug` 不可改（公开 URL 稳定优先，与 nav 一致）。
         */
        ProjectUpdateIn: {
            /** Images */
            images?: components["schemas"]["ProjectImageIn"][] | null;
            /** Links */
            links?: components["schemas"]["ProjectLinkIn"][] | null;
            /** Maintenance */
            maintenance?: ("active" | "maintained" | "paused" | "archived") | null;
            /** Outcomes */
            outcomes?: string | null;
            /** Palace Id */
            palace_id?: string | null;
            /** Problem */
            problem?: string | null;
            /** Role */
            role?: string | null;
            /** Summary */
            summary?: string | null;
            /** Tech Stack */
            tech_stack?: string[] | null;
            /** Title */
            title?: string | null;
            /** Tradeoffs */
            tradeoffs?: string | null;
        };
        /** RecordAdminListOut */
        RecordAdminListOut: {
            /** Items */
            items: components["schemas"]["RecordAdminOut"][];
            /** Next Cursor */
            next_cursor: string | null;
        };
        /** RecordAdminOut */
        RecordAdminOut: {
            /** Attempts */
            attempts: string;
            /** Background */
            background: string;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Evidence Links */
            evidence_links: components["schemas"]["EvidenceLinkOut"][];
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Outcome */
            outcome: string;
            /** Posts */
            posts: components["schemas"]["RelatedPostRelationOut"][];
            /** Projects */
            projects: components["schemas"]["RelatedProjectRelationOut"][];
            /** Published At */
            published_at: string | null;
            /** Resolved At */
            resolved_at: string | null;
            /** Slug */
            slug: string;
            /** Status */
            status: string;
            /** Title */
            title: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
            /** Version */
            version: number;
            /** Work Status */
            work_status: string;
            /** Work Status Label */
            work_status_label: string;
        };
        /** RecordCreateIn */
        RecordCreateIn: {
            /**
             * Attempts
             * @default
             */
            attempts: string;
            /**
             * Background
             * @default
             */
            background: string;
            /** Evidence Links */
            evidence_links?: components["schemas"]["EvidenceLinkIn"][];
            /**
             * Outcome
             * @default
             */
            outcome: string;
            /** Posts */
            posts?: components["schemas"]["RelatedPostRelationIn"][];
            /** Projects */
            projects?: components["schemas"]["RelatedProjectRelationIn"][];
            /** Slug */
            slug: string;
            /** Title */
            title: string;
            /**
             * Work Status
             * @default pending
             * @enum {string}
             */
            work_status: "pending" | "investigating" | "resolved" | "archived";
        };
        /** RecordDetailOut */
        RecordDetailOut: {
            /** Attempts */
            attempts: string;
            /** Background */
            background: string;
            /** Evidence Links */
            evidence_links: components["schemas"]["EvidenceLinkOut"][];
            /** Excerpt */
            excerpt: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Outcome */
            outcome: string;
            /** Post Count */
            post_count: number;
            /** Posts */
            posts: components["schemas"]["RelatedPostOut"][];
            /** Project Count */
            project_count: number;
            /** Projects */
            projects: components["schemas"]["RelatedProjectOut"][];
            /**
             * Published At
             * Format: date-time
             */
            published_at: string;
            /** Resolved At */
            resolved_at: string | null;
            /** Slug */
            slug: string;
            /** Title */
            title: string;
            /** Work Status */
            work_status: string;
            /** Work Status Label */
            work_status_label: string;
        };
        /** RecordListOut */
        RecordListOut: {
            /** Items */
            items: components["schemas"]["RecordSummaryOut"][];
            /** Next Cursor */
            next_cursor: string | null;
        };
        /**
         * RecordStatsOut
         * @description 公开工作状态统计。
         *
         *     只统计**当前公开**的记录，因此它与列表里能看到的条数完全一致 ——
         *     不把草稿算进来制造一个「其实还有 N 条隐藏记录」的暗示（验收 3）。
         */
        RecordStatsOut: {
            /** By Work Status */
            by_work_status: {
                [key: string]: number;
            };
            /** Total */
            total: number;
        };
        /** RecordSummaryOut */
        RecordSummaryOut: {
            /** Excerpt */
            excerpt: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Post Count */
            post_count: number;
            /** Project Count */
            project_count: number;
            /**
             * Published At
             * Format: date-time
             */
            published_at: string;
            /** Resolved At */
            resolved_at: string | null;
            /** Slug */
            slug: string;
            /** Title */
            title: string;
            /** Work Status */
            work_status: string;
            /** Work Status Label */
            work_status_label: string;
        };
        /**
         * RecordUpdateIn
         * @description PATCH：只改出现过的字段。`slug` 不可改（公开 URL 稳定优先）。
         */
        RecordUpdateIn: {
            /** Attempts */
            attempts?: string | null;
            /** Background */
            background?: string | null;
            /** Evidence Links */
            evidence_links?: components["schemas"]["EvidenceLinkIn"][] | null;
            /** Outcome */
            outcome?: string | null;
            /** Posts */
            posts?: components["schemas"]["RelatedPostRelationIn"][] | null;
            /** Projects */
            projects?: components["schemas"]["RelatedProjectRelationIn"][] | null;
            /** Title */
            title?: string | null;
            /** Work Status */
            work_status?: ("pending" | "investigating" | "resolved" | "archived") | null;
        };
        /**
         * RelatedPostOut
         * @description 关联的**当前公开**文章。撤回文章后这条引用整条消失（不泄漏隐藏标题）。
         */
        RelatedPostOut: {
            /** Href */
            href: string;
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
        /** RelatedPostRelationIn */
        RelatedPostRelationIn: {
            /** Position */
            position: number;
            /**
             * Post Id
             * Format: uuid
             */
            post_id: string;
        };
        /** RelatedPostRelationOut */
        RelatedPostRelationOut: {
            /** Position */
            position: number;
            /**
             * Post Id
             * Format: uuid
             */
            post_id: string;
            /** Slug */
            slug: string;
            /** Status */
            status: string;
            /** Title */
            title: string;
        };
        /**
         * RelatedProjectOut
         * @description 关联的**当前公开**作品。撤回作品后这条引用整条消失。
         */
        RelatedProjectOut: {
            /** Href */
            href: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Slug */
            slug: string;
            /** Summary */
            summary: string;
            /** Title */
            title: string;
        };
        /** RelatedProjectRelationIn */
        RelatedProjectRelationIn: {
            /** Position */
            position: number;
            /**
             * Project Id
             * Format: uuid
             */
            project_id: string;
        };
        /** RelatedProjectRelationOut */
        RelatedProjectRelationOut: {
            /** Position */
            position: number;
            /**
             * Project Id
             * Format: uuid
             */
            project_id: string;
            /** Slug */
            slug: string;
            /** Status */
            status: string;
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
        /** SessionOut */
        SessionOut: {
            ai: components["schemas"]["AiStateOut"];
            /** Characters */
            characters?: components["schemas"]["CharacterOut"][];
            /** Csrf Token */
            csrf_token: string;
            /** Disclosure */
            disclosure: string;
            usage: components["schemas"]["UsageOut"];
            visitor: components["schemas"]["VisitorOut"];
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
        /** SkillAdminListOut */
        SkillAdminListOut: {
            /** Items */
            items: components["schemas"]["SkillAdminOut"][];
            /** Next Cursor */
            next_cursor: string | null;
        };
        /** SkillAdminOut */
        SkillAdminOut: {
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Domain */
            domain: string;
            /** Domain Label */
            domain_label: string;
            /** Evidence */
            evidence: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Links */
            links: components["schemas"]["SkillLinkOut"][];
            /** Name */
            name: string;
            /** Position */
            position: number;
            /** Projects */
            projects: components["schemas"]["SkillProjectRelationOut"][];
            /** Published At */
            published_at: string | null;
            /** Scope */
            scope: string;
            /** Slug */
            slug: string;
            /** Status */
            status: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
            /** Version */
            version: number;
        };
        /**
         * SkillComboOut
         * @description 「合体」筛选结果（07 §6）。
         *
         *     两个技能与交集作品一起返回，调用方不需要再发第二次请求去补技能信息。
         *     空交集是完全正常的结果：`items` 为空、`note` 明确说明还没有对应作品，
         *     **不会**用 AI 生成一个概念顶替（任务卡执行清单）。
         */
        SkillComboOut: {
            a: components["schemas"]["SkillSummaryOut"];
            b: components["schemas"]["SkillSummaryOut"];
            /** Items */
            items: components["schemas"]["SkillProjectRefOut"][];
            /** Note */
            note: string;
        };
        /** SkillCreateIn */
        SkillCreateIn: {
            /**
             * Domain
             * @default other
             * @enum {string}
             */
            domain: "algorithm" | "frontend" | "backend" | "data" | "signal" | "systems" | "tooling" | "other";
            /**
             * Evidence
             * @default
             */
            evidence: string;
            /** Links */
            links?: components["schemas"]["SkillLinkIn"][];
            /** Name */
            name: string;
            /**
             * Position
             * @default 0
             */
            position: number;
            /** Projects */
            projects?: components["schemas"]["SkillProjectRelationIn"][];
            /**
             * Scope
             * @default
             */
            scope: string;
            /** Slug */
            slug: string;
        };
        /** SkillDetailOut */
        SkillDetailOut: {
            /** Domain */
            domain: string;
            /** Domain Label */
            domain_label: string;
            /** Evidence */
            evidence: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Links */
            links: components["schemas"]["SkillLinkOut"][];
            /** Name */
            name: string;
            /** Position */
            position: number;
            /** Project Count */
            project_count: number;
            /** Projects */
            projects: components["schemas"]["SkillProjectRefOut"][];
            /** Scope */
            scope: string;
            /** Slug */
            slug: string;
            /** Tech Overlap */
            tech_overlap: string[];
        };
        /**
         * SkillLinkIn
         * @description 一条站外证据链接。只接受 http / https（见 `links.normalize_link_url`）。
         */
        SkillLinkIn: {
            /**
             * Kind
             * @default other
             * @enum {string}
             */
            kind: "repo" | "demo" | "docs" | "proof" | "other";
            /** Label */
            label: string;
            /** Url */
            url: string;
        };
        /** SkillLinkOut */
        SkillLinkOut: {
            /** Kind */
            kind: string;
            /** Label */
            label: string;
            /** Url */
            url: string;
        };
        /** SkillListOut */
        SkillListOut: {
            /** Items */
            items: components["schemas"]["SkillSummaryOut"][];
            /** Next Cursor */
            next_cursor: string | null;
        };
        /**
         * SkillProjectRefOut
         * @description 技能关联到的一件**当前公开**作品（只给跳转必需的最小字段）。
         *
         *     这里刻意不给 `tech_stack` / `role` 等正文：技能全书要展示的是「有哪些真实证据」，
         *     作品的完整说明仍只有一份，在 `/showcase/projects/<slug>` 与 `/projects/<slug>`（05 §6）。
         */
        SkillProjectRefOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Maintenance */
            maintenance: string;
            /** Maintenance Label */
            maintenance_label: string;
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
         * SkillProjectRelationIn
         * @description 技能 → 作品关系的一条。`project_id` 必须是**已有**作品（复用，不复制履历）。
         */
        SkillProjectRelationIn: {
            /** Position */
            position: number;
            /**
             * Project Id
             * Format: uuid
             */
            project_id: string;
        };
        /**
         * SkillProjectRelationOut
         * @description 管理回执里的一条关系：附带作品标题与状态，让表单能显示「关联了一件草稿」。
         */
        SkillProjectRelationOut: {
            /** Position */
            position: number;
            /**
             * Project Id
             * Format: uuid
             */
            project_id: string;
            /** Slug */
            slug: string;
            /** Status */
            status: string;
            /** Title */
            title: string;
        };
        /** SkillSummaryOut */
        SkillSummaryOut: {
            /** Domain */
            domain: string;
            /** Domain Label */
            domain_label: string;
            /** Evidence */
            evidence: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Links */
            links: components["schemas"]["SkillLinkOut"][];
            /** Name */
            name: string;
            /** Position */
            position: number;
            /** Project Count */
            project_count: number;
            /** Scope */
            scope: string;
            /** Slug */
            slug: string;
        };
        /**
         * SkillUpdateIn
         * @description PATCH：只改出现过的字段。`slug` 不可改（公开 URL 稳定优先，与 nav / projects 一致）。
         */
        SkillUpdateIn: {
            /** Domain */
            domain?: ("algorithm" | "frontend" | "backend" | "data" | "signal" | "systems" | "tooling" | "other") | null;
            /** Evidence */
            evidence?: string | null;
            /** Links */
            links?: components["schemas"]["SkillLinkIn"][] | null;
            /** Name */
            name?: string | null;
            /** Position */
            position?: number | null;
            /** Projects */
            projects?: components["schemas"]["SkillProjectRelationIn"][] | null;
            /** Scope */
            scope?: string | null;
        };
        /**
         * StatusOut
         * @description 公开的运行状态：**不含**任何密钥，也不含访客身份。
         */
        StatusOut: {
            ai: components["schemas"]["AiStateOut"];
            /** Disclosure */
            disclosure: string;
            limits: components["schemas"]["LimitsOut"];
            /** Provider Notes */
            provider_notes?: string[];
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
        /**
         * UsageOut
         * @description 用量。**不隐藏成本**：即使额度没用完，也如实给出已结算单位。
         */
        UsageOut: {
            /** Daily Limit */
            daily_limit: number;
            /**
             * Inflight
             * @default 0
             */
            inflight: number;
            /** Remaining */
            remaining?: number | null;
            /** Requests Today */
            requests_today?: number | null;
            /**
             * Site Daily Units
             * @default 0
             */
            site_daily_units: number;
            /**
             * Site Settled Units
             * @default 0
             */
            site_settled_units: number;
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
        /** VisitorOut */
        VisitorOut: {
            /**
             * Absolute Expires At
             * Format: date-time
             */
            absolute_expires_at: string;
            /**
             * Expires At
             * Format: date-time
             */
            expires_at: string;
            /** Id */
            id: string;
        };
        /**
         * WallAlbumOut
         * @description 照片墙上引用的最小相册信息（不含草稿状态与版本，公开 DTO 不能夹带管理字段）。
         */
        WallAlbumOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Kind */
            kind: string;
            /** Kind Label */
            kind_label: string;
            /** Position */
            position: number;
            /** Slug */
            slug: string;
            /** Title */
            title: string;
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
    list_admin_albums_api_v1_admin_albums_get: {
        parameters: {
            query?: {
                status?: string | null;
                kind?: string | null;
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
                    "application/json": components["schemas"]["AlbumAdminListOut"];
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
    create_album_api_v1_admin_albums_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AlbumCreateIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AlbumAdminOut"];
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
    read_admin_album_api_v1_admin_albums__album_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                album_id: string;
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
                    "application/json": components["schemas"]["AlbumAdminOut"];
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
    delete_album_api_v1_admin_albums__album_id__delete: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                album_id: string;
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
    update_album_api_v1_admin_albums__album_id__patch: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                album_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AlbumUpdateIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AlbumAdminOut"];
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
    remove_album_photo_api_v1_admin_albums__album_id__photos__media_id__delete: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                album_id: string;
                media_id: string;
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
    publish_album_api_v1_admin_albums__album_id__publish_post: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                album_id: string;
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
                    "application/json": components["schemas"]["AlbumAdminOut"];
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
    unpublish_album_api_v1_admin_albums__album_id__unpublish_post: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                album_id: string;
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
                    "application/json": components["schemas"]["AlbumAdminOut"];
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
    list_admin_records_api_v1_admin_exploration_records_get: {
        parameters: {
            query?: {
                status?: string | null;
                work_status?: string | null;
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
                    "application/json": components["schemas"]["RecordAdminListOut"];
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
    create_record_api_v1_admin_exploration_records_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RecordCreateIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RecordAdminOut"];
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
    read_admin_record_api_v1_admin_exploration_records__record_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                record_id: string;
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
                    "application/json": components["schemas"]["RecordAdminOut"];
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
    delete_record_api_v1_admin_exploration_records__record_id__delete: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                record_id: string;
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
    update_record_api_v1_admin_exploration_records__record_id__patch: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                record_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RecordUpdateIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RecordAdminOut"];
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
    publish_record_api_v1_admin_exploration_records__record_id__publish_post: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                record_id: string;
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
                    "application/json": components["schemas"]["RecordAdminOut"];
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
    unpublish_record_api_v1_admin_exploration_records__record_id__unpublish_post: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                record_id: string;
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
                    "application/json": components["schemas"]["RecordAdminOut"];
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
    admin_overview_api_v1_admin_messaging_overview_get: {
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
    list_admin_projects_api_v1_admin_projects_get: {
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
                    "application/json": components["schemas"]["ProjectAdminListOut"];
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
    create_project_api_v1_admin_projects_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProjectCreateIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectAdminOut"];
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
    read_admin_project_api_v1_admin_projects__project_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project_id: string;
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
                    "application/json": components["schemas"]["ProjectAdminOut"];
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
    delete_project_api_v1_admin_projects__project_id__delete: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                project_id: string;
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
    update_project_api_v1_admin_projects__project_id__patch: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                project_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProjectUpdateIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectAdminOut"];
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
    publish_project_api_v1_admin_projects__project_id__publish_post: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                project_id: string;
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
                    "application/json": components["schemas"]["ProjectAdminOut"];
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
    unpublish_project_api_v1_admin_projects__project_id__unpublish_post: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                project_id: string;
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
                    "application/json": components["schemas"]["ProjectAdminOut"];
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
    list_admin_skills_api_v1_admin_skills_get: {
        parameters: {
            query?: {
                status?: string | null;
                domain?: string | null;
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
                    "application/json": components["schemas"]["SkillAdminListOut"];
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
    create_skill_api_v1_admin_skills_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SkillCreateIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SkillAdminOut"];
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
    read_admin_skill_api_v1_admin_skills__skill_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                skill_id: string;
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
                    "application/json": components["schemas"]["SkillAdminOut"];
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
    delete_skill_api_v1_admin_skills__skill_id__delete: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                skill_id: string;
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
    update_skill_api_v1_admin_skills__skill_id__patch: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                skill_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SkillUpdateIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SkillAdminOut"];
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
    publish_skill_api_v1_admin_skills__skill_id__publish_post: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                skill_id: string;
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
                    "application/json": components["schemas"]["SkillAdminOut"];
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
    unpublish_skill_api_v1_admin_skills__skill_id__unpublish_post: {
        parameters: {
            query?: never;
            header?: {
                "If-Match"?: string | null;
            };
            path: {
                skill_id: string;
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
                    "application/json": components["schemas"]["SkillAdminOut"];
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
    list_records_api_v1_exploration_records_get: {
        parameters: {
            query?: {
                work_status?: string | null;
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
                    "application/json": components["schemas"]["RecordListOut"];
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
    read_stats_api_v1_exploration_records_stats_get: {
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
                    "application/json": components["schemas"]["RecordStatsOut"];
                };
            };
        };
    };
    read_record_api_v1_exploration_records__slug__get: {
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
                    "application/json": components["schemas"]["RecordDetailOut"];
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
    list_albums_api_v1_gallery_albums_get: {
        parameters: {
            query?: {
                kind?: string | null;
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
                    "application/json": components["schemas"]["AlbumListOut"];
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
    read_album_api_v1_gallery_albums__slug__get: {
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
                    "application/json": components["schemas"]["AlbumDetailOut"];
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
    list_photos_api_v1_gallery_photos_get: {
        parameters: {
            query?: {
                scope?: string;
                album?: string | null;
                kind?: string | null;
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
                    "application/json": components["schemas"]["PhotoListOut"];
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
    list_photo_years_api_v1_gallery_photos_years_get: {
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
                    "application/json": number[];
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
    list_characters_api_v1_messaging_characters_get: {
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
                    "application/json": components["schemas"]["CharacterOut"][];
                };
            };
        };
    };
    create_conversation_api_v1_messaging_conversations_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConversationCreateIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConversationOut"];
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
    read_conversation_api_v1_messaging_conversations__conversation_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                conversation_id: string;
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
                    "application/json": components["schemas"]["ConversationOut"];
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
    delete_conversation_api_v1_messaging_conversations__conversation_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                conversation_id: string;
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
    choose_option_api_v1_messaging_conversations__conversation_id__choice_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                conversation_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChoiceIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConversationOut"];
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
    send_message_api_v1_messaging_conversations__conversation_id__messages_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                conversation_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MessageIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConversationOut"];
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
    restart_story_api_v1_messaging_conversations__conversation_id__restart_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                conversation_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NodeVersionIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConversationOut"];
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
    resume_topic_api_v1_messaging_conversations__conversation_id__resume_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                conversation_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NodeVersionIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConversationOut"];
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
    ensure_session_api_v1_messaging_session_post: {
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
                    "application/json": components["schemas"]["SessionOut"];
                };
            };
        };
    };
    clear_session_api_v1_messaging_session_delete: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
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
        };
    };
    read_status_api_v1_messaging_status_get: {
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
                    "application/json": components["schemas"]["StatusOut"];
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
    list_projects_api_v1_projects_get: {
        parameters: {
            query?: {
                maintenance?: string | null;
                tech?: string | null;
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
                    "application/json": components["schemas"]["ProjectListOut"];
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
    read_project_api_v1_projects__slug__get: {
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
                    "application/json": components["schemas"]["ProjectDetailOut"];
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
    list_skills_api_v1_skills_get: {
        parameters: {
            query?: {
                domain?: string | null;
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
                    "application/json": components["schemas"]["SkillListOut"];
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
    read_combo_api_v1_skills_combo_get: {
        parameters: {
            query: {
                /** @description 技能 A 的 slug */
                a: string;
                /** @description 技能 B 的 slug */
                b: string;
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
                    "application/json": components["schemas"]["SkillComboOut"];
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
    read_skills_for_project_api_v1_skills_projects__slug__get: {
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
                    "application/json": components["schemas"]["SkillSummaryOut"][];
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
    read_skill_api_v1_skills__slug__get: {
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
                    "application/json": components["schemas"]["SkillDetailOut"];
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
