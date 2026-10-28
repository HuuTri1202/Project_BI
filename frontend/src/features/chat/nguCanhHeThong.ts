import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useAuth } from '../../auth/useAuth';
import { readRememberedWorkspace } from '../../workspace/workspaceStorage';
import * as billingApi from '../billing/api';
import { billingKeys } from '../billing/keys';
import * as moHinhApi from '../datamodels/api';
import { dataModelKeys } from '../datamodels/keys';
import * as tenantApi from '../tenant/api';
import { tenantKeys } from '../tenant/keys';
import {
  duKienDanhSachMoHinh,
  duKienKetNoi,
  duKienKhoDuLieu,
  duKienDonHang,
  duKienThanhToan,
  duKienTrangChu,
  duKienWorkspace,
  tomTatBoDuLieu,
  tomTatMoHinh,
} from './duKienTrang';
import type { Nguon } from './nguCanh';

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

const HOI_DON = {
  page: 1,
  pageSize: TRAN,
  status: '' as const,
  sort: 'createdAt',
  order: 'desc' as const,
};

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

  /*
   * Ở ĐÂY LÀ BA MODULE CÒN LẠI CỦA HỆ THỐNG: workspace, thành viên, gói dịch vụ.
   *
   * Bản tóm tắt cũ chỉ biết bốn loại đối tượng: bộ dữ liệu, mô hình, kết nối,
   * báo cáo. Nên "hỏi từ bất kỳ trang nào" vẫn tắt ở đúng mấy câu người ta hay
   * hỏi nhất khi đứng ngoài khu dữ liệu: "ai là quản trị viên", "tổ chức đang
   * dùng gói nào", "tôi vào được mấy workspace".
   *
   * ⚠️ QUYỀN VẪN LÀ QUYỀN CỦA CHÍNH ENDPOINT — không thêm một dòng kiểm nào ở đây.
   *
   * Đó là cả lý do lớp này gọi BỐN endpoint riêng thay vì một endpoint "lấy hết".
   * `GET /billing/me` đi qua `authorize('billing', 'read')`, `GET /members` qua
   * `authorize('member', 'read')`. Ai không có thì ăn 403, `data` là `undefined`, và
   * bản tóm tắt thiếu đúng phần đó — không phải vì ai đó nhớ viết một chốt,
   * mà vì không có đường nào để quên nó. Một endpoint gom hết sẽ đảo chiều đó:
   * lúc đó quyền là một việc phải nhớ làm.
   */
  const workspace = useQuery({
    queryKey: tenantKeys.workspaces(),
    queryFn: () => tenantApi.fetchWorkspaces(),
    enabled: dangMo,
    staleTime: 60_000,
  });

  const donHang = useQuery({
    queryKey: billingKeys.orderList(HOI_DON),
    queryFn: () => billingApi.fetchOrders(HOI_DON),
    enabled: dangMo,
    staleTime: 60_000,
  });

  const goi = useQuery({
    queryKey: billingKeys.summary(),
    queryFn: () => billingApi.fetchBillingSummary(),
    enabled: dangMo,
    staleTime: 60_000,
  });

  return useMemo(() => {
    const kd = kho.data;
    const mh = moHinh.data;
    const kn = ketNoi.data;
    const nh = nha.data;
    const ws = workspace.data;
    const gi = goi.data;
    const dh = donHang.data;
    if ([kd, mh, kn, nh, ws, gi, dh].every((x) => x === undefined)) return [];

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
        ...(ws === undefined ? [] : (duKienWorkspace(ws)[0]?.duKien ?? [])),
        /*
         * CHỈ phần tóm tắt của đơn hàng — KHÔNG đưa từng đơn vào danh sách nguồn.
         *
         * Đã đo: đổ từng mục của một module mới vào danh sách xuyên hệ thống làm
         * phép so giữa các mục bắt đầu so nhầm loại này với loại kia — thêm thành
         * viên vào cho ra bốn câu SAI. Phần tóm tắt thì không có rủi ro đó: nó là
         * mấy con số của cả tổ chức, không phải một mục đem ra so.
         */
        ...(dh === undefined ? [] : (duKienDonHang(dh.items, dh.total)[0]?.duKien ?? [])),
        /*
         * ⚠️ CHỈ lấy phần NHẬN DẠNG gói, BỎ khối "Đã dùng bao nhiêu …".
         *
         * Khối hạn mức đếm lại workspace, báo cáo, thành viên và dung lượng — đúng
         * mấy thứ bản tóm tắt này đã khai từ nguồn khác, chỉ khác phạm vi. Hai dự
         * kiện cùng nói một khái niệm ở hai phạm vi thì không phải thêm một câu trả
         * lời — chúng HOÀ điểm và luật "phải hơn hẳn ứng viên nhì" bỏ cả hai.
         *
         * ĐO ĐƯỢC: "có bao nhiêu thành viên" đang ĐÚNG (3, từ trang chủ) trở
         * thành bế tắc ngay khi nhãn "Đã dùng bao nhiêu thành viên" được thêm vào.
         */
        ...(gi === undefined
          ? []
          : (duKienThanhToan(gi)[0]?.duKien ?? []).filter(
              (d) => !d.nhan.startsWith('Đã dùng bao nhiêu'),
            )),
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
  }, [kho.data, moHinh.data, ketNoi.data, nha.data, workspace.data, goi.data, donHang.data]);
}
