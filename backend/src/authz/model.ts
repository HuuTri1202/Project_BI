/**
 * Casbin model — §6.2.
 *
 * ─── Vì sao là .ts chứ không phải model.conf ────────────────────────────────
 *
 * Đề bài ghi "file model.conf". Ở đây nó là một chuỗi trong TypeScript, cùng
 * đúng lý do mà migration không nằm trong file .sql (xem `db/migrations.ts`):
 * **`tsc` KHÔNG copy file không phải .ts sang `dist/`.** Bản build production sẽ
 * thiếu `model.conf`, và `newEnforcer` ném lỗi lúc khởi động — sau khi đã deploy.
 *
 * Cách khác là thêm bước copy vào script build và nhớ giữ nó đúng mãi mãi. Một
 * chuỗi trong .ts thì dev và production dùng chung đúng một nguồn, không có gì
 * để quên. Nội dung dưới đây vẫn là cú pháp model.conf nguyên bản của Casbin,
 * chép nguyên vào một file .conf là chạy được.
 *
 * ─── Đọc model này ──────────────────────────────────────────────────────────
 *
 *   sub  chủ thể   — vai trò trong tổ chức ('admin' | 'creator' | 'viewer')
 *   dom  phạm vi   — `tenantId`, dạng chuỗi. Đây là phần "domain" của RBAC.
 *   obj  tài nguyên— 'report' | 'workspace' | 'member' | …
 *   act  hành động — 'read' | 'modify' | 'invite' | 'delete'
 *
 * ─── Vì sao `g` có mặt dù hiện chưa có dòng `g` nào ─────────────────────────
 *
 * `r.sub` mà middleware truyền vào LÀ vai trò, không phải id người dùng. Casbin
 * cho `g(a, b, dom)` trả về true khi `a === b` kể cả khi không có dòng `g` nào,
 * nên model này chạy đúng ngay hôm nay.
 *
 * Giữ `g` lại vì nó là chỗ để cắm hai thứ về sau mà KHÔNG phải sửa model:
 * cấp quyền riêng cho một người (`g, user:42, admin, 3`), và vai trò lồng nhau.
 *
 * Cố ý KHÔNG nạp dòng `g` cho toàn bộ `memberships` như ghi chú trong
 * `db/migrations.ts` từng phác. Lý do thực tế phát hiện khi làm: `requireFreshMembership`
 * đã đọc vai trò THẬT từ database ở mỗi request rồi. Nạp `g` vào bộ nhớ lúc khởi
 * động sẽ dựng lại đúng cái vấn đề mà middleware đó sinh ra để diệt — một người
 * vừa bị hạ quyền vẫn được Casbin cho qua tới lần reload sau. Truyền thẳng vai
 * trò tươi vào `enforce` thì không có trạng thái nào để cũ.
 *
 * ─── Điều model này KHÔNG làm, và đừng bao giờ nhờ nó làm ───────────────────
 *
 * Nó trả lời "vai trò này được làm gì với LOẠI tài nguyên này", KHÔNG trả lời
 * "dòng dữ liệu này có thuộc tổ chức của bạn không". Câu thứ hai do
 * `WHERE tenant_id = ?` trong mọi repository trả lời, và đó mới là thứ chặn
 * đọc chéo tổ chức. Nhầm hai câu này là mất sạch dữ liệu của mọi công ty.
 */
export const CASBIN_MODEL = `
[request_definition]
r = sub, dom, obj, act

[policy_definition]
p = sub, dom, obj, act

[role_definition]
g = _, _, _

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = g(r.sub, p.sub, r.dom) \
    && (p.dom == "*" || r.dom == p.dom) \
    && (p.obj == "*" || r.obj == p.obj) \
    && (p.act == "*" || r.act == p.act)
`;
