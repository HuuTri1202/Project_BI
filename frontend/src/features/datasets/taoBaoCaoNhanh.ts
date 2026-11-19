import { LOAD_STATUS_LABELS, type DatasetLoadStatus } from '@bi/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getApiError } from '../../services/apiClient';
import * as datamodelApi from '../datamodels/api';

/**
 * "Tạo báo cáo" ngay từ MỘT bộ dữ liệu đã có — vá B2, và mong muốn D3.
 *
 * ═══ Lỗ đã đo khi dùng hệ thống như người thật ═════════════════════════════
 *
 * Tải tệp lên xong rồi thì KHÔNG có đường nào vẽ biểu đồ từ nó. Menu "Tạo báo
 * cáo" chỉ có hai mục: "Tạo nhanh với file Excel/CSV" (mở lại đúng wizard tải
 * lên — tức là bảo người dùng tải tệp đó lên lần nữa) và "Tạo từ mô hình dữ
 * liệu có sẵn". Muốn dùng bộ vừa tải thì phải sang Kho dữ liệu → Tạo mô hình →
 * rồi mới Tạo báo cáo, và phải học khái niệm "mô hình dữ liệu" trước khi thấy
 * cái biểu đồ đầu tiên.
 *
 * ═══ Vì sao dùng lại ĐÚNG đường của wizard ════════════════════════════════
 *
 * `UploadWizard` với `goal === 'report'` đã làm chính việc này từ §10.13: dựng
 * một mô hình trên các sheet vừa nạp rồi vào thẳng trình dựng. Nên ở đây không
 * có cơ chế mới nào — chỉ là cùng hai bước ấy, bắt đầu từ một bộ dữ liệu đã
 * nằm trong kho thay vì từ một tệp vừa tải lên. Mô hình sinh ra được LƯU và bày
 * ra như mọi mô hình khác (§10.13), không phải mô hình ẩn.
 *
 * ═══ Chưa nạp vào kho phân tích thì NÓI, không dựng bừa ═══════════════════
 *
 * `POST /datamodels` trả 409 `DatasetNotLoaded` khi bảng trong ClickHouse chưa
 * tồn tại. Chặn trước ở đây để câu thông báo nói đúng việc cần làm, thay vì dội
 * một mã lỗi của tầng dưới lên mặt người dùng.
 */
export interface BoChoBaoCao {
  id: number;
  name: string;
  workspaceId: number;
  loadStatus: DatasetLoadStatus;
}

export interface TaoBaoCaoNhanh {
  chay: (bo: BoChoBaoCao) => void;
  dangChay: boolean;
  /** Câu lỗi cho người dùng đọc, `null` khi chưa có gì. */
  loi: string | null;
  xoaLoi: () => void;
}

export function useTaoBaoCaoNhanh(): TaoBaoCaoNhanh {
  const navigate = useNavigate();
  const [dangChay, setDangChay] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);

  function chay(bo: BoChoBaoCao): void {
    if (dangChay) return;
    setLoi(null);

    if (bo.loadStatus !== 'loaded') {
      setLoi(
        `Bộ dữ liệu đang ở trạng thái "${LOAD_STATUS_LABELS[bo.loadStatus]}". ` +
          'Biểu đồ đọc số từ kho phân tích, nên hãy chờ nạp xong (hoặc bấm "Nạp vào kho phân tích" ở tab Kho phân tích) rồi tạo báo cáo.',
      );
      return;
    }

    setDangChay(true);
    void (async () => {
      try {
        /*
         * Tên mô hình lấy theo tên bộ dữ liệu, và KHÔNG thêm hậu tố nào.
         *
         * Người dùng sẽ gặp lại cái tên này ở màn Mô hình dữ liệu, nên nó phải
         * là thứ họ nhận ra. Một hậu tố kiểu "(tự tạo)" thì vừa dài vừa gợi ý
         * rằng mô hình này hạng hai — mà nó không phải: nó sửa được, thêm thước
         * đo được, dùng cho báo cáo khác được, y như mọi mô hình khác.
         */
        const model = await datamodelApi.createDataModel({
          workspaceId: bo.workspaceId,
          name: bo.name,
          datasetIds: [bo.id],
        });
        navigate(`/datamodels/${String(model.id)}/report/new`);
      } catch (err) {
        setLoi(getApiError(err).message);
      } finally {
        setDangChay(false);
      }
    })();
  }

  return { chay, dangChay, loi, xoaLoi: () => setLoi(null) };
}
