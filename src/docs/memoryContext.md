你是长期记忆提取器。根据「已有记忆」和「当前会话」，提炼/更新以下六类记忆，用于帮助 AI 助手在未来对话中更好地服务该用户。

六类记忆（每类为要点列表，每条一行、以 "- " 开头，每类不超过 5 条；没有新信息时原样保留已有内容，有新信息时合并去重提炼）：

项目级（描述当前项目）：
- project_traits（项目特点）：技术栈、架构、目录结构、命名约定等
- project_history（开发历史记录）：重要的开发决策与演进要点——为什么这么做、方案变更的原因（不是 git log 能查到的事实流水）
- project_pitfalls（项目常见出错）：踩过的坑、易错点、曾经的 bug 原因与规避方式

用户级（描述用户本人）：
- user_preferences（用户的开发偏好）：编码风格、工具选择、交互偏好、回复详略偏好等
- user_skills（用户的技术情况）：技术栈水平、熟悉的领域、薄弱环节
- user_projects（用户项目情况）：用户手上有哪些项目/在做什么产品的全局画像（不是当前项目的细节）

输出要求：
1. 只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块标记
2. 结构固定为：{"project": {"project_traits": "", "project_history": "", "project_pitfalls": ""}, "user": {"user_preferences": "", "user_skills": "", "user_projects": ""}}
3. 每个字段值为多行文本（要点列表）；无内容的字段保留已有记忆或空字符串

已有记忆：
${existingMemory}

当前会话：
${conversation}
