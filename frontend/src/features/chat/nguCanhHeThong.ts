import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import * as moHinhApi from '../datamodels/api';
import { dataModelKeys } from '../datamodels/keys';
import * as tenantApi from '../tenant/api';
import { tenantKeys } from '../tenant/keys';
import { duKienDanhSachMoHinh, duKienKhoDuLieu } from './duKienTrang';
import type { Nguon } from './nguCanh';

/**
 * Dữ kiện XUYÊN HỆ THỐNG — thứ khung trả lời được mà trang đang mở không giữ.
 *
 * ═══ Vì sao gọi hai endpoint ĐÃ CÓ, không dựng một endpoint "hỏi gì cũng trả" ═
 *
 * Vì lớp quyền. `GET /datasets` và `GET /datamodels` đã đi qua
 * `authorize('dataset', 'read')` và `authorize('datamodel', 'read')`, mà
 * `viewer` CỐ Ý không có hai quyền đó (migration 26 xoá khỏi `casbin_rule`).
 * Nên với một viewer, hai lời gọi này trả 403, `data` là `undefined`, và khung
 * không có nguồn nào của hệ thống — không cần thêm một dòng kiểm quyền nào ở
 * đây, và không có đường nào để quên nó.
 *
 * Một endpoint tổng hợp riêng cho khung hỏi đáp thì ngược lại: nó phải tự dựng
 * lại toàn bộ lớp quyền đó, và mỗi quyền mới thêm vào hệ thống là một chỗ nữa
 * phải nhớ sửa.
 *
 * ═══ Vì sao bỏ trống `workspaceId` ════════════════════════════════════════
 *
 * Người dùng hỏi "xuyên hệ thống", không hỏi "trong workspace đang mở" — và cả
 * hai schema đều hiểu `workspaceId` vắng mặt là CẢ TỔ CHỨC (xem
 * `listDatasetsQuerySchema`). Khung cũng nằm ngoài `WorkspaceProvider`: nó được
 * dựng ở `ProtectedRoute` để phủ cả trang báo cáo, nên nó không có workspace
 * nào trong tay mà đọc. Lấy id từ `localStorage` là nuôi một bản sao thứ hai
 * của trạng thái đó, và một bản sao sẽ cũ — câu trả lời khi ấy nói về workspace
 * người dùng vừa rời.
 *
 * ═══ Chỉ gọi khi khung ĐANG MỞ ════════════════════════════════════════════
 *
 * Khung có mặt trên mọi trang đã đăng nhập. Không có cờ này thì mỗi lần tải bất
 * cứ trang nào cũng là hai request mà phần lớn không ai hỏi tới. Cùng khuôn với
 * `useDataModels(query, { enabled })` và `useDataModelsElsewhere`.
 *
 * Khoá cache dùng CHÍNH hàm khoá của hai tính năng kia, nên `useInvalidateDatasets`
 * và `useInvalidateDataModel` dọn luôn cho chỗ này — không thêm một khoá nữa
 * phải nhớ xoá sau mỗi lần ghi.
 */

/**
 * Trần số mục kéo về.
 *
 * ⚠️ Vượt trần thì câu trả lời so sánh KHÔNG còn là "cao nhất toàn tổ chức".
 * Nó không im: `soSanhNguon` luôn nói ra nó so trên bao nhiêu mục, nên con số
 * đó lệch khỏi tổng là dấu hiệu đọc được ngay trong câu trả lời.
 */
const TRAN = 200;

const HOI_DATASET = {
  page: 1,
  pageSize: TRAN,
  sort: 'name',
  order: 'asc' as const,
  q: '',
  connectionId: '' as const,
  source: '' as const,
};

const HOI_MO_HINH = {
  page: 1,
  pageSize: TRAN,
  q: '',
  sort: 'updatedAt',
  order: 'desc' as const,
};

export function useNguCanhHeThong(dangMo: boolean): Nguon[] {
  const kho = useQuery({
    queryKey: tenantKeys.datasetList(HOI_DATASET),
    queryFn: () => tenantApi.fetchDatasets(HOI_DATASET),
    enabled: dangMo,
    staleTime: 60_000,
  });

  const moHinh = useQuery({
    queryKey: dataModelKeys.list(null, HOI_MO_HINH),
    queryFn: () => moHinhApi.fetchDataModels(HOI_MO_HINH),
    enabled: dangMo,
    staleTime: 60_000,
  });

  return useMemo(() => {
    const kd = kho.data;
    const mh = moHinh.data;
    if (kd === undefined && mh === undefined) return [];

    /*
     * Bản tóm tắt phải là nguồn ĐẦU TIÊN — `traLoiHeThong` và `luaChonHeThong`
     * đọc nó theo vị trí đó.
     *
     * Nhãn nói "toàn bộ tổ chức" chứ không phải "workspace này": đây là chỗ
     * duy nhất biết phạm vi thật của con số, và một nhãn nói sai phạm vi thì
     * mọi câu trả lời dựng từ nó cũng nói sai.
     *
     * ⚠️ Tên nguồn cố ý KHÔNG nằm trong nhãn nào của chính nó. `boTenMuc` nhận
     * một thuộc tính SO ĐƯỢC bằng cách tìm tên mục trong nhãn, nên để tên này
     * lọt vào nhãn là biến bản tóm tắt thành một mục ngang hàng với từng bộ dữ
     * liệu — rồi "tổng số" bị đem so với "số dòng của một bộ".
     */
    const tomTat: Nguon = {
      ten: 'Tổng quan toàn tổ chức',
      duKien: [
        ...(kd === undefined
          ? []
          : [{ nhan: 'Số bộ dữ liệu trong toàn bộ tổ chức', gia: String(kd.total) }]),
        ...(mh === undefined
          ? []
          : [{ nhan: 'Số mô hình dữ liệu trong toàn bộ tổ chức', gia: String(mh.total) }]),
      ],
    };

    return [
      tomTat,
      ...(kd === undefined ? [] : duKienKhoDuLieu(kd.items)),
      /*
       * `.slice(1)` bỏ bản tóm tắt của hàm kia đi: nhãn của nó nói "trong
       * workspace này", mà truy vấn ở đây là của cả tổ chức. Giữ lại là hai
       * bản tóm tắt nói hai phạm vi khác nhau trong cùng một danh sách, và
       * `chonThuocTinh` thì không phân biệt được hai cái đó.
       */
      ...(mh === undefined ? [] : duKienDanhSachMoHinh(mh.items, mh.total).slice(1)),
    ];
  }, [kho.data, moHinh.data]);
}
