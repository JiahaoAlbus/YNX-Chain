/** UI-only unavailable explanations. These are not actions or service capabilities. */
export const unavailableFeatures = [
  {
    "id": "invite",
    "en": "Invitations",
    "zh": "邀请入口设计",
    "reasonEn": "This version cannot safely perform this action yet. Existing account data and operations are preserved.",
    "reasonZh": "当前版本暂不支持此操作。已有账户数据和操作记录会保留。"
  },
  {
    "id": "invite-preview",
    "en": "Invitation details",
    "zh": "邀请预览",
    "reasonEn": "This version cannot safely perform this action yet. Existing account data and operations are preserved.",
    "reasonZh": "当前版本暂不支持此操作。已有账户数据和操作记录会保留。"
  },
  {
    "id": "invite-expired",
    "en": "Expired invitation",
    "zh": "邀请已失效",
    "reasonEn": "This version cannot safely perform this action yet. Existing account data and operations are preserved.",
    "reasonZh": "当前版本暂不支持此操作。已有账户数据和操作记录会保留。"
  },
  {
    "id": "moment-comments",
    "en": "Comments",
    "zh": "瞬间评论",
    "reasonEn": "This version cannot safely perform this action yet. Existing account data and operations are preserved.",
    "reasonZh": "当前版本暂不支持此操作。已有账户数据和操作记录会保留。"
  },
  {
    "id": "moment-thumbnail",
    "en": "Private thumbnails",
    "zh": "受限缩略图",
    "reasonEn": "This version cannot safely perform this action yet. Existing account data and operations are preserved.",
    "reasonZh": "当前版本暂不支持此操作。已有账户数据和操作记录会保留。"
  },
  {
    "id": "group-create",
    "en": "Create a group",
    "zh": "创建小群聊",
    "reasonEn": "This version cannot safely perform this action yet. Existing account data and operations are preserved.",
    "reasonZh": "当前版本暂不支持此操作。已有账户数据和操作记录会保留。"
  },
  {
    "id": "group-detail",
    "en": "Group details",
    "zh": "群详情 / 加入 / 退出",
    "reasonEn": "This version cannot safely perform this action yet. Existing account data and operations are preserved.",
    "reasonZh": "当前版本暂不支持此操作。已有账户数据和操作记录会保留。"
  },
  {
    "id": "group-members",
    "en": "Group members",
    "zh": "成员管理与移除",
    "reasonEn": "This version cannot safely perform this action yet. Existing account data and operations are preserved.",
    "reasonZh": "当前版本暂不支持此操作。已有账户数据和操作记录会保留。"
  },
  {
    "id": "group-permissions",
    "en": "Group permissions",
    "zh": "权限变化",
    "reasonEn": "This version cannot safely perform this action yet. Existing account data and operations are preserved.",
    "reasonZh": "当前版本暂不支持此操作。已有账户数据和操作记录会保留。"
  },
  {
    "id": "profile-edit",
    "en": "Edit profile",
    "zh": "资料编辑",
    "reasonEn": "This version cannot safely perform this action yet. Existing account data and operations are preserved.",
    "reasonZh": "当前版本暂不支持此操作。已有账户数据和操作记录会保留。"
  },
  {
    "id": "device-revoke",
    "en": "Revoke a device",
    "zh": "撤销设备确认",
    "reasonEn": "This version cannot safely perform this action yet. Existing account data and operations are preserved.",
    "reasonZh": "当前版本暂不支持此操作。已有账户数据和操作记录会保留。"
  },
  {
    "id": "backup",
    "en": "Backup and recovery",
    "zh": "备份与恢复入口",
    "reasonEn": "This version cannot safely perform this action yet. Existing account data and operations are preserved.",
    "reasonZh": "当前版本暂不支持此操作。已有账户数据和操作记录会保留。"
  },
  {
    "id": "backup-export",
    "en": "Export backup",
    "zh": "备份导出",
    "reasonEn": "This version cannot safely perform this action yet. Existing account data and operations are preserved.",
    "reasonZh": "当前版本暂不支持此操作。已有账户数据和操作记录会保留。"
  },
  {
    "id": "backup-import",
    "en": "Import backup",
    "zh": "备份导入",
    "reasonEn": "This version cannot safely perform this action yet. Existing account data and operations are preserved.",
    "reasonZh": "当前版本暂不支持此操作。已有账户数据和操作记录会保留。"
  },
  {
    "id": "identity-recovery",
    "en": "Recover identity",
    "zh": "身份恢复",
    "reasonEn": "This version cannot safely perform this action yet. Existing account data and operations are preserved.",
    "reasonZh": "当前版本暂不支持此操作。已有账户数据和操作记录会保留。"
  },
  {
    "id": "sync-conflict",
    "en": "Sync conflicts",
    "zh": "多设备同步冲突",
    "reasonEn": "This version cannot safely perform this action yet. Existing account data and operations are preserved.",
    "reasonZh": "当前版本暂不支持此操作。已有账户数据和操作记录会保留。"
  },
  {
    "id": "connection",
    "en": "Connection status",
    "zh": "连接状态与备用路径",
    "reasonEn": "This version cannot safely perform this action yet. Existing account data and operations are preserved.",
    "reasonZh": "当前版本暂不支持此操作。已有账户数据和操作记录会保留。"
  },
  {
    "id": "ai-result",
    "en": "Local filter results",
    "zh": "本地 AI 过滤结果",
    "reasonEn": "This version cannot safely perform this action yet. Existing account data and operations are preserved.",
    "reasonZh": "当前版本暂不支持此操作。已有账户数据和操作记录会保留。"
  },
  {
    "id": "logout",
    "en": "Sign out",
    "zh": "真正退出登录",
    "reasonEn": "This version cannot safely perform this action yet. Existing account data and operations are preserved.",
    "reasonZh": "当前版本暂不支持此操作。已有账户数据和操作记录会保留。"
  }
] as const;
export type UnavailableFeatureId = typeof unavailableFeatures[number]['id'];
