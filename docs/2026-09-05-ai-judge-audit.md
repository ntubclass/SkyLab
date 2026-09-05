# AI Judge／AI 檢查完整盤點與低風險優化

> 盤點日期：2026-09-05（Asia/Taipei）
>
> 範圍：Teacher Judge 的 session、評分表來源、聊天室附件、腳本 artifact、腳本執行、學生完成訊號、template command catalog，以及對應的 frontend workflow、Alembic migration 與測試。
>
> 性質：程式碼與目前設定資料庫的唯讀盤點，附不改變功能契約的局部優化。沒有刪除資料表、資料、migration，也沒有執行部署或 commit。

## 一、結論先行

### 1. 沒有可安全直接刪除的 AI Judge 資料表

目前 8 張主要資料表都有至少一個真實 runtime consumer、migration 或跨功能依賴。即使目前列數為 0，也不能只依列數判定為死表：`teacher_judge_session_attachments` 已接到 session chat 與 AI context；`teacher_judge_student_submissions` 則被學生 Course AI assignment 流程讀寫。

目前設定資料庫的唯讀 snapshot：

| 資料表 | 列數 | 目前狀態／關聯 | 判定 |
| --- | ---: | --- | --- |
| `teacher_judge_sessions` | 3 | 3 筆皆 `active`；3 筆都有 selected file | 保留，session 根資料 |
| `teacher_judge_session_messages` | 2 | 無 orphan session message | 保留，對話、提案與摘要來源 |
| `teacher_judge_files` | 4 | 4 筆皆 `active`；其中 1 筆未被目前 session 選用，是可再次選擇的 class library 文件，不是 orphan | 保留，來源與 revision 真實資料 |
| `teacher_judge_session_attachments` | 0 | 目前沒有待送出或已送出的附件；upload、parse、AI context 與刪除路徑仍在用 | 保留，不能因目前為 0 列而刪除 |
| `teacher_judge_script_artifacts` | 3 | 3 筆都有 session 與 source file；皆 `approved` | 保留，腳本版本、審查結果與課程作業來源 |
| `teacher_judge_script_runs` | 3 | 3 筆皆能連到 artifact；皆 `completed` | 保留，執行歷史與學生結果來源 |
| `teacher_judge_student_submissions` | 1 | 1 筆 `is_ready=true`，由 `app/services/course/ai_assignment_service.py` 使用 | 保留，學生逐項完成訊號 |
| `teacher_judge_template_commands` | 18 | 18 筆皆 enabled；涵蓋 linux、python、n8n、postgresql | 保留，AI prompt 與 `check_steps` 的受控 catalog |

關聯檢查結果：`orphan_messages=0`、`orphan_artifacts=0`、`orphan_runs=0`、`unattached_attachments=0`；3 個 artifact 都有 session/source file，1 個未選用的 active file 屬正常 library 狀態。資料會持續變動，這是本次檢查時間點的 evidence，不是永久保證。

歷史 migration `tc03_retire_test_groups.py` 已將舊的 AI Judge group ownership 遷移／退役；目前模型與資料表使用 `teaching_class_id`，沒有現行 `group_id` 死表可清。歷史 migration 檔仍是 schema chain 的一部分，不應刪除。

### 2. 本次已做的安全優化

這些修改不改變 API response schema、權限、AI prompt、安全政策或刪除語意：

1. `GET .../judge/sessions/` 使用 `session_public_many()` 批次載入 selected file 與 message/script/run counts，避免每一筆 session 各自發出多個 count query。
2. session message list 與 `bounded_history()` 使用一次批次查詢取得附件，保留原本的訊息／附件順序與排除當前附件的語意，避免附件 N+1 與同一列重複查詢。
3. 待送出附件數量改用資料庫 `COUNT`，不再把所有 pending rows 載入 Python 後再 `len()`。
4. 前端在 server 將 `selected_file_id` 清空或來源不再存在時，清除舊的 analysis、檔名、環境與未確認提案狀態，避免刪除來源後畫面仍顯示上一份評分表。

### 3. 沒有做的事

沒有刪除任何表、欄位、index、舊 endpoint、archive status、shell/bat enum、failed attachment status 或歷史 migration。這些項目都有相容性、資料保留或現有 fallback 風險，詳見第六節。

## 二、實際 runtime 資料流

```text
教師瀏覽器
  -> AiJudgePage / AiJudgePanel
  -> frontend/src/services/aiJudge.js
  -> /api/v1/teaching-classes/{class_id}/judge/*
  -> teacher_judge_sessions / files / messages / attachments
  -> rubric analysis、chat proposal、teacher autosave
  -> script artifact policy + quality + AI review
  -> approved script run -> VM/SSH target revalidation -> per-target result
  -> Course AI assignment / student completion projection
```

主要入口與責任邊界：

| 邊界 | 實作位置 | 檢查結果 |
| --- | --- | --- |
| Session／對話 | `backend/app/api/routes/teacher_judge_sessions.py`、`backend/app/ai/teacher_judge/session_service.py` | session class access、selected source ownership、revision conflict、history limit、summary interval 都有明確邏輯 |
| 評分表來源 | `backend/app/api/routes/teacher_judge_files.py`、`file_service.py` | upload/blank/update/clone/delete 共用 class scope；source file 有 revision 與 active/replaced lifecycle |
| 附件 | `attachment_service.py` 與 session routes | 副檔名、大小、空檔、解析文字上限、單次最多 5 件、message scope 與 sent attachment 保護均存在 |
| 腳本產生 | `script_artifact_service.py` | generation → policy → quality → AI reviewer；只有 gate 與 reviewer 都通過才進入 `approved` |
| 腳本執行 | `script_run_service.py`、`script_executor_service.py` | 目前只接受 `manual` target scope；執行前重新確認 artifact、class、running resource，並處理逐 target 結果與遠端暫存清理 |
| 學生投影 | `services/course/ai_assignment_service.py` | 只暴露核准 artifact 的必要 rubric/result；`TeacherJudgeStudentSubmission` 只記錄學生完成訊號，不會自行啟動 AI run |

## 三、刪除與清理語意檢查

### Session 刪除

`delete_session` → `delete_session_data()` 會在同一個 transaction 中清理該 session 的 runs、messages、attachments、artifacts；selected rubric 只有在沒有其他 session 使用時才 stage delete。檔案先移到可 restore 的 deleted path，commit 成功後 finalize，rollback 則 restore。這個顯式流程同時支援 SQLite 測試資料庫與未啟用 FK enforcement 的環境，不應以單純 ORM cascade 取代。

### 來源文件刪除

`stage_file_delete()` 會清掉 artifact 的 `source_file_id`、session 的 `selected_file_id`，並在 transaction 成功後移除實體檔；已建立的腳本使用 snapshot，所以來源刪除不會破壞已建立的 artifact。前端也會重新取得 session，現在再加上狀態清理，避免視覺上殘留舊 analysis。

### Artifact 與 Run 刪除

artifact 直接刪除時由資料庫 cascade 清理 runs；session 刪除仍顯式先處理 runs，保留跨資料庫的一致性。已完成的 run 結果是課程學生頁的依賴，不是可任意清掉的暫存資料。

### Chat 附件刪除

只有尚未送出的 pending attachment 可刪除；已附加到 sent message 的附件會回傳 409，避免歷史訊息與 AI context 失真。`failed` status 目前是相容／未來錯誤記錄狀態，現行 parser 失敗會在落庫前回報，不能因此刪掉 status 或整張表。

## 四、pipeline 檢查與可優化點

### A. 評分表匯入與編輯

`prepare_file_payload`／document parser 先驗證副檔名、大小與內容，再取得 enabled template commands 給 AI；`save_analyzed_file` 保存 analysis、environment keys、source metadata 與 `analysis_revision`。前端 autosave 以 file id 與 revision 送回，遇到 revision conflict 不會靜默覆蓋別人的修改。

目前沒有發現可在不改變契約下移除的中間資料。`analysis_json`、source snapshot 與 revision 分別承擔目前分析、artifact 可重現性與並發保護，不是重複欄位。

### B. Chat／proposal

chat 將長附件文字放在獨立 user-data context，並對附件內容標示為不可信資料；history 上限為 20 則／24,000 字元，摘要每 10 則 assistant turn 嘗試更新。AI request 的 frontend timeout 為 60 秒，沒有把全域 API 預設 15 秒放寬；script generation 另有 7 分鐘上限。

本次將 history 與 message response 的附件讀取批次化，未改變 proposal、`updated_items`、teacher confirmation 或 autosave 行為。

### C. Script artifact

artifact 建立時會保存 rubric、source file snapshot 與 command snapshot，接著依序執行 policy、quality validator、AI reviewer 與受限 retry。相容 wrapper（例如舊測試／舊 caller 使用的 result shape）仍被保留；不應以「看起來重複」為由刪除。

### D. Execution

目前 run service 明確限制 `manual` scope，執行器會再次解析 running VM／SSH/IP 與 class ownership，完成後保存 summary、target results，並清理遠端暫存檔。這條路徑涉及實際 VM/SSH，未在本次對外執行任何 run。

## 五、Index 與資料庫 evidence

本次唯讀執行：

```text
uv run alembic heads  -> tjatt01_msg_attachments (head)
uv run alembic current -> tjatt01_msg_attachments (head)
uv run alembic check  -> No new upgrade operations detected.
```

`pg_stat_user_indexes` 看到部分 index 掃描數很低或為 0，也看到實際使用中的 index，例如：

- `teacher_judge_files.ix_teacher_judge_files_class_created`：411
- `teacher_judge_files.ix_teacher_judge_files_teaching_class_id`：72
- `teacher_judge_session_messages.ix_teacher_judge_session_messages_session_id`：921
- `teacher_judge_script_runs.ix_teacher_judge_script_runs_artifact_created`：214
- `teacher_judge_student_submissions.uq_teacher_judge_student_submission_artifact_student`：84

這些統計是目前資料庫累積的 planner statistics，不能直接代表長期 production workload；零掃描也可能是低流量、最近建立、被 composite index 取代，或 FK／唯一性所需。故本次不刪 index、不新增 migration。若要做 index cleanup，應先在 production 觀察一個完整流量週期、用 `EXPLAIN (ANALYZE, BUFFERS)` 驗證主要 query，再建立可回退 migration。

## 六、延後候選（需要額外證據或產品決策，不在本次刪除）

| 候選 | 為何目前不刪 | 安全的下一步 |
| --- | --- | --- |
| `teacher_judge_session_attachments` 空表 | 功能與 route 已接通，未來附件上傳會立即使用 | 只做 pending／sent／failed retention 指標；若要清資料，先定義保存期限與檔案清理 job |
| 未選用或 `replaced` file | 未選用 file 可能是教師的 class library；artifact 也可能只保留 snapshot 而仍需追溯 source | 先加最後使用時間／審計，再由教師確認或明確 retention policy 清理 |
| 低掃描 index | 統計不是穩定 workload 證據，且部分 index 來自 FK、unique 或查詢排序 | production stats + EXPLAIN + migration review |
| `/api/v1/rubric/*` 與 direct script API | `AiJudgeService` 仍保留 legacy 方法，`RubricsTab` 仍有 fallback；移除會破壞舊頁面／整合者 | 加 usage telemetry，公告 deprecation，確認 client 遷移後再刪 |
| archive/status、shell/bat、failed enum | 歷史 API、資料列或測試可能仍依賴；目前 UI 隱藏不等於契約不存在 | 先做資料／API usage audit，再另立相容 migration |
| template command query cache | command catalog 可由管理端動態啟停；無 invalidation 會讓 AI 使用過時能力 | 若 profiling 證明需要，採短 TTL 並明確 invalidation，不在本次預建 cache |

## 七、本次修改檔案

- `backend/app/ai/teacher_judge/session_service.py`
  - 新增 `session_public_many()` 批次組裝 session public response。
  - 新增 `message_attachments_by_message_ids()`，並讓 `bounded_history()` 使用批次附件 context。
  - 保留原 `session_public()`、`message_attachments()` 單筆 API，避免影響既有 caller。
- `backend/app/api/routes/teacher_judge_sessions.py`
  - session list 改用 batch serializer；message list 改用 batch attachment map；pending count 改用 SQL `COUNT`。
- `backend/tests/test_teacher_judge_sessions.py`
  - 新增 batch serializer 與既有單筆 response contract 相等的回歸測試。
- `frontend/src/pages/course-operations/class-workspace/AiJudgePanel.jsx`
  - selected source 清空／失效時清除舊 analysis 與未確認 proposal 狀態。
- `docs/2026-09-05-ai-judge-audit.md`
  - 本盤點、資料表判定、pipeline、刪除語意、延後候選與驗證界線。

## 八、驗證結果與界線

已實際執行：

| 驗證 | 結果 |
| --- | --- |
| Backend Teacher Judge focused tests（attachments/files/sessions/template commands/boundaries） | 58 passed（包含新增 batch contract 測試） |
| Frontend `AiJudgePanel.test.jsx`、`aiJudge.test.js` | 41 tests passed |
| Frontend `bun run build` | 成功；只有既有大型 chunk warning，非本次錯誤 |
| Ruff（Teacher Judge app/routes/models/tests） | `All checks passed!` |
| Mypy（本次修改的 `session_service.py`、`teacher_judge_sessions.py`） | `Success: no issues found in 2 source files` |
| Alembic heads/current/check | head/current 一致；無待產生 upgrade operation |
| 設定資料庫 table/count/linkage/index 唯讀查詢 | 執行成功；未做任何資料寫入 |

尚未由本次 focused checks 證明的項目：

- 未執行 authenticated browser E2E。
- 未呼叫 live vLLM、Proxmox、SSH 或實際 script run；因此不宣稱模型 readiness、遠端執行與網路拓樸已通過。
- 未執行 production retention cleanup 或 index migration；這些需要明確保存期限、流量 evidence、備份與回退方案。

**總結：**目前沒有應直接刪除的 AI Judge 資料表或功能 pipeline。已完成的調整集中在查詢批次化與來源刪除後 UI 一致性，對外契約與安全邊界維持不變；資料清理與 legacy API 移除應依第六節條件另立可回退工作。
