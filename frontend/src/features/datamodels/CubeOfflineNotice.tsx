import { Button } from '../../components/ui/Button';

/**
 * Cube.js chưa chạy — nói đúng lệnh phải gõ.
 *
 * ═══ Vì sao là một component dùng chung ═════════════════════════════════════
 *
 * Hai màn hình phụ thuộc Cube: tab Explorer (§10.7) và trình dựng biểu đồ
 * (§10.9). Cả hai trắng xoá theo đúng một cách khi container Cube tắt, và cả
 * hai phải nói đúng một câu — lệnh trong khối `<code>` mà lệch nhau một chữ là
 * một trong hai màn dạy người dùng gõ sai.
 *
 * Câu lệnh KHÔNG viết cứng ở đây: nó tới từ `GET /explorer-status` để frontend
 * và docker-compose không thể lệch nhau. Cùng tiền lệ `pingClickhouse` của §9,
 * vốn tồn tại vì bài học MinIO: khi một service phía sau tắt, thứ người dùng
 * thấy là "Có lỗi không xác định" — một câu không dẫn tới bất kỳ hành động nào.
 */
export function CubeOfflineNotice({
  command,
  onRetry,
  retrying,
  children,
}: {
  command: string;
  onRetry: () => void;
  retrying: boolean;
  /**
   * "Cái gì VẪN dùng được" — khác nhau ở mỗi màn hình, nên nơi gọi tự viết.
   *
   * Nó đáng giá đúng bằng câu lệnh phía trên: người đọc một màn hình báo lỗi
   * cần biết mình có phải dừng hẳn công việc lại hay không.
   */
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4" role="alert">
      <h2 className="text-sm font-semibold text-amber-900">
        Chưa kết nối được tới tầng ngữ nghĩa (Cube.js)
      </h2>
      <p className="mt-1.5 text-sm text-amber-900">Chạy lệnh sau ở thư mục gốc rồi bấm Thử lại:</p>
      <code className="mt-2 block rounded-lg bg-amber-100 px-3 py-2 font-mono text-sm text-amber-900">
        {command}
      </code>
      {children !== undefined && <p className="mt-2.5 text-sm text-amber-800">{children}</p>}
      <div className="mt-3">
        <Button onClick={onRetry} loading={retrying}>
          Thử lại
        </Button>
      </div>
    </div>
  );
}
