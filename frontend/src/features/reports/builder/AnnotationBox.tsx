import { ANNOTATION_TEXT_MAX, type ReportAnnotationDto, type TextAnnotationDto } from '@bi/shared';
import { useEffect, useLayoutEffect, useRef } from 'react';

import { AnnotationView } from '../annotations/AnnotationView';
import { CANVAS_LAYER_Z, textFrameStyle, textStyle } from '../annotations/annotationStyle';
import { cellStyle } from '../canvasLayout';
import { describeAnnotation } from './annotation';
import { appear } from './glide';

/**
 * Một chú thích trên khung SOẠN THẢO — §10.18.
 *
 * Cùng cách kéo, co giãn và phím tắt với ô biểu đồ (`CanvasBoard` giữ phần đó
 * cho cả hai), khác ở ba chỗ:
 *
 *   1. KÉO Ở ĐÂU CŨNG ĐƯỢC. Ô biểu đồ chỉ kéo bằng thanh tiêu đề vì phần thân là
 *      biểu đồ có tooltip; chú thích thì không có gì bên trong để bấm, và một
 *      đường kẻ cao một hàng không có chỗ nào cho một thanh tiêu đề.
 *   2. BẤM ĐÚP ĐỂ GÕ. Chữ sửa ngay TẠI CHỖ, đúng cỡ, đúng màu, đúng chỗ xuống
 *      dòng — gõ vào một ô ở bảng bên phải rồi liếc sang khung để xem thì chữ
 *      nhảy dòng ở đâu cũng không biết trước.
 *   3. KHÔNG CÓ NỀN TRẮNG. Chú thích nằm thẳng trên khung; khung chọn và viền
 *      nét đứt chỉ hiện khi rê chuột hoặc khi đang chọn.
 *
 * ⚠️ Mọi phím bấm TRONG ô gõ chữ phải dừng lại ở ô gõ. Không thì Backspace để
 * xoá một chữ sẽ xoá luôn cả hộp văn bản, và mũi tên để dời con trỏ sẽ dời cả
 * hộp đi. Xem `onKeyDown` bên dưới — nó chỉ nhận phím khi chính hộp đang được
 * chọn, không phải khi thứ gì bên trong nó đang được gõ.
 */
export function AnnotationBox({
  annotation,
  selected,
  editing,
  onSelect,
  onGrabMove,
  onGrabResize,
  onPointerMove,
  onPointerUp,
  onKeyDown,
  onRemove,
  onEdit,
  onText,
}: {
  annotation: ReportAnnotationDto;
  selected: boolean;
  /** Hộp văn bản đang ở chế độ gõ chữ. */
  editing: boolean;
  onSelect: () => void;
  onGrabMove: (event: React.PointerEvent<HTMLElement>) => void;
  onGrabResize: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  /** Mũi tên, Shift+mũi tên, Delete — phần dùng chung với ô biểu đồ. */
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onRemove: () => void;
  onEdit: (editing: boolean) => void;
  onText: (text: string) => void;
}): React.ReactElement {
  const boxRef = useRef<HTMLElement>(null);
  const label = describeAnnotation(annotation);
  const isText = annotation.kind === 'text';

  /*
   * Một hình không nền, không viền là một hình VÔ HÌNH — và một thứ vô hình trên
   * khung soạn thảo là thứ không ai tìm được để xoá. Nên nó luôn mang viền nét
   * đứt, kể cả khi không rê chuột. Trang xem thì không: ở đó nó vô hình thật.
   */
  const invisible =
    annotation.kind === 'shape' && annotation.fill === null && annotation.stroke === null;

  /*
   * Hộp XUẤT HIỆN trong trạng thái đang chọn thì nhận tiêu điểm.
   *
   * Đó chỉ có thể là hộp người dùng vừa tạo — bấm một nút trên thanh Chèn, hay
   * bấm "Nhân bản". Không có bước này thì tiêu điểm vẫn nằm trên cái nút vừa
   * bấm: người dùng thả một đường kẻ xuống, bấm Delete vì thả nhầm, và không có
   * gì xảy ra. Hộp văn bản thì bỏ qua — ô gõ chữ của nó tự lấy tiêu điểm.
   *
   * Chạy đúng một lần lúc gắn, không theo `selected`: bấm vào một hộp đã có sẵn
   * thì trình duyệt đã tự đưa tiêu điểm vào, và giật tiêu điểm theo mỗi lần
   * `selected` đổi sẽ kéo nó ra khỏi bảng bên phải ngay khi người dùng bấm vào
   * một nút ở đó.
   *
   * Cùng lúc đó hộp HIỆN RA nhẹ (§10.20): chỗ trống `findSlot` tìm được có thể
   * nằm dưới cả hai biểu đồ, và một hộp bật ra tức thì ở đó thì mắt không bắt kịp
   * nó rơi xuống đâu.
   */
  useEffect(() => {
    if (!selected) return;
    if (boxRef.current !== null) appear(boxRef.current);
    if (!editing) boxRef.current?.focus({ preventScroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ lúc gắn, xem trên
  }, []);

  return (
    <section
      ref={boxRef}
      style={{ ...cellStyle(annotation), zIndex: CANVAS_LAYER_Z[annotation.layer] }}
      tabIndex={0}
      aria-label={label}
      onFocus={onSelect}
      onPointerDown={(e) => {
        // Đang gõ chữ thì bấm chuột là để đặt con trỏ, không phải để kéo hộp.
        if (editing) return;
        // `begin` gọi `preventDefault` để khỏi bôi đen chữ khi kéo — và việc đó
        // cũng chặn trình duyệt tự đưa tiêu điểm vào hộp. Không có tiêu điểm thì
        // bấm chọn xong, phím mũi tên không làm gì.
        e.currentTarget.focus({ preventScroll: true });
        onGrabMove(e);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={isText ? () => onEdit(true) : undefined}
      onKeyDown={(e) => {
        // Phím bấm nổi lên từ ô gõ chữ hoặc từ nút Xoá — không phải của hộp.
        if (e.target !== e.currentTarget) return;
        if (isText && (e.key === 'Enter' || e.key === 'F2')) {
          e.preventDefault();
          onEdit(true);
          return;
        }
        onKeyDown(e);
      }}
      className={`relative outline-none ${editing ? 'cursor-text' : 'cursor-move'} ${
        selected
          ? 'ring-2 ring-brand-500/70 ring-offset-1'
          : invisible
            ? 'outline outline-slate-300 outline-dashed'
            : 'hover:outline hover:outline-slate-400 hover:outline-dashed'
      }`}
    >
      {editing && annotation.kind === 'text' ? (
        <TextEditor
          annotation={annotation}
          onText={onText}
          onDone={() => onEdit(false)}
          onEscape={() => boxRef.current?.focus()}
        />
      ) : (
        <AnnotationView
          annotation={annotation}
          placeholder={isText ? 'Bấm đúp để nhập chữ' : undefined}
        />
      )}

      {selected && !editing && (
        <>
          <button
            type="button"
            onClick={onRemove}
            // Dừng ở đây: không thì bấm nút Xoá cũng khởi động một cú kéo hộp.
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={`Xoá ${label}`}
            className="absolute -top-2.5 -right-2.5 flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-[10px] text-slate-500 shadow-sm hover:border-red-300 hover:text-red-600"
          >
            ✕
          </button>
          {/* Vùng BẤM 20px bọc một ô vuông NHÌN THẤY 10px (§10.20). Bản cũ là
              12px cho cả hai, và đo trên Chromium thì một cú bấm lệch 1px ra
              ngoài mép là trượt hẳn — con trỏ rơi xuống khung phía sau và cú kéo
              co giãn biến thành không có gì. */}
          <span
            onPointerDown={(e) => {
              e.stopPropagation();
              onGrabResize(e);
            }}
            aria-hidden="true"
            className="absolute -right-2.5 -bottom-2.5 flex h-5 w-5 cursor-nwse-resize items-center justify-center"
          >
            <span className="h-2.5 w-2.5 rounded-sm border border-brand-500 bg-white" />
          </span>
        </>
      )}
    </section>
  );
}

/**
 * Ô gõ chữ đặt đúng chỗ hộp văn bản, cùng cỡ chữ, cùng màu, cùng căn lề.
 *
 * `<textarea>` tự CAO theo nội dung chứ không trải kín hộp: nhờ vậy khung ngoài
 * (`textFrameStyle`) vẫn căn giữa hay căn đáy được nó, và bấm đúp vào một tiêu
 * đề căn giữa không làm dòng chữ nhảy lên mép trên.
 */
function TextEditor({
  annotation,
  onText,
  onDone,
  onEscape,
}: {
  annotation: TextAnnotationDto;
  onText: (text: string) => void;
  onDone: () => void;
  onEscape: () => void;
}): React.ReactElement {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [annotation.text, annotation.fontSize, annotation.bold]);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    el.focus({ preventScroll: true });
    // Con trỏ ở CUỐI: người bấm đúp vào một đoạn có sẵn gần như luôn để viết tiếp.
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  return (
    <div style={textFrameStyle(annotation)}>
      <textarea
        ref={ref}
        value={annotation.text}
        rows={1}
        maxLength={ANNOTATION_TEXT_MAX}
        aria-label="Nội dung hộp văn bản"
        placeholder="Nhập chữ…"
        onChange={(e) => onText(e.target.value)}
        onBlur={onDone}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          e.preventDefault();
          // Trả tiêu điểm về HỘP, không để nó rơi xuống `body`: người dùng bàn
          // phím vừa gõ xong vẫn phải dời được hộp bằng mũi tên. Việc rời ô gõ
          // cũng chính là thứ bắn `onBlur` và kết thúc chế độ gõ.
          onEscape();
        }}
        style={{
          ...textStyle(annotation),
          display: 'block',
          width: '100%',
          maxHeight: '100%',
          padding: 0,
          border: 'none',
          outline: 'none',
          resize: 'none',
          overflow: 'hidden',
          background: 'transparent',
        }}
      />
    </div>
  );
}
