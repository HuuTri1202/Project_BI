import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useAuth } from '../../auth/useAuth';
import { readRememberedWorkspace } from '../../workspace/workspaceStorage';
import * as moHinhApi from '../datamodels/api';
import { dataModelKeys } from '../datamodels/keys';
import * as tenantApi from '../tenant/api';
import { tenantKeys } from '../tenant/keys';
import {
  duKienDanhSachMoHinh,
  duKienKetNoi,
  duKienKhoDuLieu,
  duKienTrangChu,
  tomTatBoDuLieu,
  tomTatMoHinh,
} from './duKienTrang';
import type { Nguon } from './nguCanh';

/**
 * Dữ kiện XUYÊN HỆ THỐNG — thứ khung trả lời được mà trang đang mở không giữ.
 *
 * ═══ Vì sao gọi mấy endpoint ĐÃ CÓ, không dựng một endpoint "hỏi gì cũng trả" ═
 *
 * Vì lớp quyền. `GET /datasets` và `GET /datamodels` đã đi qua
 * `authorize('dataset', 'read')` và `authorize('datamodel', 'read')`, mà
 * `viewer` CỐ Ý không có hai quyền đó (migration 26 xoá khỏi `casbin_rule`).
 * Nên với một viewer, mấy lời gọi này trả 403, `data` là `undefined`, và khung
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

/** Phạm vi dán vào nhãn — xem khối `tomTatBoDuLieu` bên `duKienTrang.ts`. */
const PHAM = 'trong toàn bộ tổ chức';

export function useNguCanhHeThong(dangMo: boolean): Nguon[] {
  const { tenant } = useAuth();

  /*
   * Workspace để hỏi báo cáo — đọc từ ĐÚNG chỗ mà `WorkspaceProvider` ghi.
   *
   * Báo cáo là thứ DUY NHẤT trong bản tóm tắt này không ở phạm vi tổ chức:
   * `GET /reports` đòi `workspaceId`, còn `GET /datasets` và `GET /datamodels`
   * hiểu "vắng mặt" là cả tổ chức. Mà khung thì nằm NGOÀI `WorkspaceProvider`
   * (nó phải phủ cả trang báo cáo toàn màn hình — xem `NguCanhProvider`), nên
   * `useWorkspace` không dùng được ở đây.
   *
   * Đọc `localStorage` KHÔNG phải nuôi một bản sao thứ hai: đó chính là nơi
   * `WorkspaceProvider` ghi mỗi lần người dùng đổi workspace, và cũng là nơi nó
   * đọc lên lúc khởi động. `null` thì backend chọn workspace đang hoạt động đầu
   * tiên — đúng cái provider cũng rơi về khi chưa nhớ gì. Hai bên luôn khớp.
   *
   * Và dù có lệch thì câu trả lời vẫn không nói dối: nhãn mang TÊN workspace mà
   * server trả về ("Số báo cáo trong workspace HR"), không phải một chữ
   * "workspace này" chung chung không kiểm chứng được.
   */
  const wsId = tenant === null ? null : readRememberedWorkspace(tenant.id);

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

  /*
   * Hai lời gọi nữa, cùng một khuôn và cùng một lý do: người dùng hỏi "có bao
   * nhiêu báo cáo", "có bao nhiêu kết nối" từ BẤT KỲ trang nào, kể cả trang hồ
   * sơ cá nhân. Không có chúng thì "xuyên hệ thống" chỉ có nghĩa với hai trong
   * số bốn loại đối tượng chính của hệ thống.
   *
   * Lớp quyền vẫn là lớp quyền của chính endpoint đó: `GET /connections` đi qua
   * `authorize('connection', 'read')`, và ai không có thì ăn 403, `data` là
   * `undefined`, bản tóm tắt thiếu đúng phần đó. Không một dòng kiểm quyền nào
   * ở đây, và không có đường nào để quên nó.
   */
  const ketNoi = useQuery({
    queryKey: tenantKeys.connections(),
    queryFn: () => tenantApi.fetchConnections(),
    enabled: dangMo,
    staleTime: 60_000,
  });

  const nha = useQuery({
    queryKey: tenantKeys.home(wsId),
    queryFn: () => tenantApi.fetchHome(wsId),
    enabled: dangMo,
    staleTime: 60_000,
  });

  return useMemo(() => {
    const kd = kho.data;
    const mh = moHinh.data;
    const kn = ketNoi.data;
    const nh = nha.data;
    if (kd === undefined && mh === undefined && kn === undefined && nh === undefined) return [];

    // `duKienTrangChu` trả về [nguồn workspace, ...từng thẻ báo cáo]; `duKienKetNoi`
    // trả về [nguồn tóm tắt, ...từng kết nối]. Tách làm đôi ở đây: phần đếm đi
    // vào bản tóm tắt chung, phần từng mục đi vào danh sách nguồn.
    const trangChu = nh === undefined ? [] : duKienTrangChu(nh);
    const dsKetNoi = kn === undefined ? [] : duKienKetNoi(kn);

    /*
     * Bản tóm tắt phải là nguồn ĐẦU TIÊN — `traLoiHeThong` và `luaChonHeThong`
     * đọc nó theo vị trí đó.
     *
     * Nó dùng CHÍNH mấy hàm mà trang danh sách dùng, chỉ khác vế `pham`. Đó là cả
     * lý do chúng được tách ra: câu "bao nhiêu tệp Excel" phải đếm giống hệt nhau
     * dù người dùng đang đứng ở Kho dữ liệu hay đang ở trang hồ sơ.
     *
     * ⚠️ Tên nguồn cố ý KHÔNG nằm trong nhãn nào của chính nó. `boTenMuc` nhận
     * một thuộc tính SO ĐƯỢC bằng cách tìm tên mục trong nhãn, nên để tên này lọt
     * vào nhãn là biến bản tóm tắt thành một mục ngang hàng với từng bộ dữ liệu —
     * rồi "tổng số" bị đem so với "số dòng của một bộ".
     */
    const tomTat: Nguon = {
      ten: 'Tổng quan toàn tổ chức',
      duKien: [
        ...(kd === undefined ? [] : tomTatBoDuLieu(kd.items, kd.total, PHAM)),
        ...(mh === undefined ? [] : tomTatMoHinh(mh.items, mh.total, PHAM)),
        ...(dsKetNoi[0]?.duKien ?? []),
        ...(trangChu[0]?.duKien ?? []),
      ],
    };

    return [
      tomTat,
      /*
       * `.slice(1)` bỏ bản tóm tắt của từng hàm đi: nhãn của chúng nói "trong
       * workspace này", mà truy vấn ở đây là của cả tổ chức. Giữ lại là hai bản
       * tóm tắt nói hai phạm vi khác nhau trong cùng một danh sách, và `chonThuocTinh`
       * thì không phân biệt được hai cái đó.
       */
      ...(kd === undefined ? [] : duKienKhoDuLieu(kd.items, kd.total).slice(1)),
      ...(mh === undefined ? [] : duKienDanhSachMoHinh(mh.items, mh.total).slice(1)),
      ...dsKetNoi.slice(1),
      ...trangChu.slice(1),
    ];
  }, [kho.data, moHinh.data, ketNoi.data, nha.data]);
}
