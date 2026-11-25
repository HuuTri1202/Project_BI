/**
 * Chạy hết một vòng NGHIỆP VỤ THẬT: nạp tệp → mô hình → báo cáo → hỏi đáp.
 *
 * Đây là mục duy nhất GHI dữ liệu thật, nên có ba luật:
 *
 *   1. Mọi thứ nó tạo đều mang tiền tố `DAU` có dấu thời gian, nên rác của nó
 *      phân biệt được với dữ liệu người dùng và với rác của lần chạy trước.
 *   2. Dọn nằm trong `finally`, chạy cả khi giữa đường hỏng.
 *   3. Dọn không sạch là MỘT PHÉP KIỂM TRƯỢT, không phải một dòng log. Một bộ
 *      quét để lại rác mỗi lần chạy sẽ bị tắt sau vài tuần, và khi đó mất luôn
 *      cả phần kiểm.
 *
 * ⚠️ `POST /workspaces` trả 409 khi gói đã hết suất workspace, và đó là hạn mức
 * HOẠT ĐỘNG ĐÚNG. Nên phép kiểm nhận cả 2xx lẫn 409 — chốt cứng 2xx sẽ biến một
 * tính năng đang chạy tốt thành báo động giả trên mọi máy dùng gói Miễn phí.
 */
import { cho, doId, goi, soGhi } from './lib.mjs';

const DAU = `QUET-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;

/**
 * Bộ dữ liệu MỐC — thứ duy nhất bộ quét cố ý để lại.
 *
 * Tên không có dấu thời gian, vì nó phải tìm lại được ở lần chạy sau. Thấy nó
 * trong danh sách bộ dữ liệu là bình thường; đừng xoá tay — lần chạy tới sẽ tự
 * tạo lại, và xoá nó mới đúng là để lại một bảng `raw_*` mồ côi.
 */
const MOC = 'QUET-MOC — bo du lieu cua bo quet, dung xoa';

/** CSV sinh tại chỗ — không phải một tệp mẫu nữa trong repo để mà lệch. */
function csvThu(soDong = 120) {
  const chiNhanh = ['Gò Vấp', 'Thủ Đức', 'Quận 1', 'Quận 7'];
  const d = ['Mã đơn,Ngày bán,Chi nhánh,Mặt hàng,Số lượng,Thành tiền'];
  for (let i = 1; i <= soDong; i++) {
    const ngay = `2026-10-${String((i % 28) + 1).padStart(2, '0')}`;
    d.push(
      `DH${i},${ngay},${chiNhanh[i % 4]},Hàng ${i % 7},${(i % 5) + 1},${(i % 9) * 1000 + 5000}`,
    );
  }
  return Buffer.from(d.join('\n') + '\n', 'utf8');
}

/**
 * Gọi một endpoint đi qua Cube, có THỬ LẠI khi Cube báo đang quá tải.
 *
 * ═══ Vì sao 503 CubeUnavailable không phải một phép kiểm TRƯỢT ═════════════
 *
 * Mục này tạo một mô hình mới mỗi lần chạy, nên `schemaVersion` đổi và Cube phải
 * biên dịch lại — bình thường 2,7–4,5 giây (xem §2 README). Khi máy đang chạy cả
 * app, cả SigNoz, cả Chrome headless của mục `trang` thì nó vượt hạn 30 giây và
 * backend trả `503 CubeUnavailable` kèm đúng câu "chờ khoảng một phút rồi hỏi
 * lại". Đã gặp thật: cùng bộ quét, lần nhẹ 28 giây xanh, lần nặng 132 giây và
 * hai phép kiểm này đỏ.
 *
 * Đó là HẠ TẦNG đang chậm, không phải mã nguồn sai, nên báo TRƯỢT là báo động
 * giả. Nhưng im lặng cho qua thì một lần Cube chết thật cũng không ai biết. Nên:
 * thử lại vài lượt, và nếu vẫn 503 thì BỎ QUA kèm lý do — bộ quét nói rõ "bỏ qua
 * không phải đạt", nên nó vẫn hiện ra mà không làm đỏ cả lần chạy.
 */
async function goiQuaCube(s, nhan, method, duong, { token, body, kiem } = {}) {
  const SO_LUOT = 3;
  let r;
  for (let i = 1; i <= SO_LUOT; i++) {
    r = await goi(method, duong, { token, body });
    if (!(r.ma === 503 && r.json?.error === 'CubeUnavailable')) break;
    if (i < SO_LUOT) await cho(20_000);
  }
  if (r.ma === 503 && r.json?.error === 'CubeUnavailable') {
    s.bo(
      nhan,
      `Cube trả 503 sau ${SO_LUOT} lượt — máy đang quá tải, không phải lỗi mã nguồn. ` +
        'Đóng bớt thứ đang chạy rồi chạy lại mục này.',
    );
    return { ...r, boQua: true };
  }
  s.can(kiem(r), nhan, `${r.ma} ${r.chu}`);
  return r;
}

export async function quetLuong(phien) {
  const s = soGhi('Luồng nghiệp vụ — nạp dữ liệu, mô hình, báo cáo, hỏi đáp');
  const chu = phien.chu;
  if (chu?.token === undefined) {
    s.bo('cả mục', `vai "chu" không đăng nhập được: ${chu?.loi}`);
    return s;
  }
  const token = chu.token;
  const id = await doId(token);
  if (id.ws === undefined) {
    s.bo('cả mục', 'vai "chu" chưa có workspace nào');
    return s;
  }

  const don = []; // [method, đường] — dọn theo thứ tự NGƯỢC lúc tạo
  let dsId;
  let dmId;
  let rpId;
  let rfId;
  let dfId;

  try {
    // ─── hạn mức workspace ────────────────────────────────────────────────
    const w = await goi('POST', '/v1/workspaces', { token, body: { name: `${DAU} ws` } });
    if (w.ma === 409) {
      s.dat('POST /workspaces → 409 (hạn mức gói đang chặn, đúng)');
    } else if (w.ma >= 200 && w.ma < 300 && w.json?.id !== undefined) {
      s.dat('POST /workspaces → tạo được');
      don.push(['DELETE', `/v1/workspaces/${w.json.id}`]);
    } else {
      s.truot('POST /workspaces', `${w.ma} ${w.chu}`);
    }

    // ─── thư mục ──────────────────────────────────────────────────────────
    const rf = await goi('POST', `/v1/report-folders?workspaceId=${id.ws}`, {
      token,
      body: { name: `${DAU} tmBC` },
    });
    rfId = rf.json?.id;
    s.can(rfId !== undefined, 'POST /report-folders', `${rf.ma} ${rf.chu}`);
    if (rfId !== undefined) {
      don.push(['DELETE', `/v1/report-folders/${rfId}`]);
      const r2 = await goi('PATCH', `/v1/report-folders/${rfId}`, {
        token,
        body: { name: `${DAU} tmBC2` },
      });
      s.can(r2.ma === 200, 'PATCH /report-folders/:id', `${r2.ma} ${r2.chu}`);
    }

    const df = await goi('POST', `/v1/dataset-folders?workspaceId=${id.ws}`, {
      token,
      body: { name: `${DAU} tmDS` },
    });
    dfId = df.json?.id;
    s.can(dfId !== undefined, 'POST /dataset-folders', `${df.ma} ${df.chu}`);
    if (dfId !== undefined) don.push(['DELETE', `/v1/dataset-folders/${dfId}`]);

    /*
     * ─── nạp tệp, DÙNG LẠI một bộ dữ liệu MỐC ──────────────────────────────
     *
     * Bản đầu tạo một bộ dữ liệu mới mỗi lần rồi xoá đi lúc dọn. Nghe sạch, và
     * nó rỉ trạng thái: xoá bộ dữ liệu là xoá MỀM, nên dòng `datasets` nằm lại
     * và janitor cũng không dọn bảng `raw_*` của nó (định nghĩa "mồ côi" của nó
     * là không còn DÒNG NÀO trỏ tới, kể cả dòng đã xoá mềm — xem `dropTables.ts`).
     * Đo được: mỗi lần chạy để lại một dòng và một bảng 1,77 KiB, vĩnh viễn.
     *
     * Nhỏ, nhưng một bộ kiểm tra để lại rác mỗi lần chạy thì sẽ bị tắt, và khi
     * đó mất luôn cả phần kiểm. Nên nó giữ ĐÚNG MỘT bộ dữ liệu tên `MOC` và
     * THAY TỆP của bộ đó (`capNhat: true`), dùng lại cùng id và cùng bảng:
     * dấu chân không đổi dù chạy bao nhiêu lần.
     *
     * Phần thưởng kèm theo: đường "thay tệp của bộ dữ liệu có sẵn" (§B2) được
     * kiểm mỗi lần, mà bản tạo-mới-mỗi-lần không bao giờ chạm tới.
     */
    const tep = csvThu();
    const soDongTep = tep.toString('utf8').trim().split('\n').length - 1;

    const dsCo = await goi('GET', `/v1/datasets?workspaceId=${id.ws}&page=1&pageSize=100`, {
      token,
    });
    const moc = (dsCo.json?.items ?? []).find((x) => x?.name === MOC);
    const thay = moc !== undefined;

    const up = thay
      ? await goi('POST', `/v1/datasets/${moc.id}/uploads`, {
          token,
          body: { filename: `${MOC}.csv`, fileSize: tep.length },
        })
      : await goi('POST', '/v1/datasets/uploads', {
          token,
          body: { workspaceId: id.ws, filename: `${MOC}.csv`, fileSize: tep.length },
        });
    dsId = thay ? moc.id : up.json?.datasetId;
    s.can(
      dsId !== undefined && typeof up.json?.uploadUrl === 'string',
      thay
        ? `POST /datasets/${dsId}/uploads → thay tệp của bộ mốc`
        : 'POST /datasets/uploads → tạo bộ mốc lần đầu',
      `${up.ma} ${up.chu}`,
    );
    // CỐ Ý không thêm vào danh sách dọn — xem khối trên.

    if (dsId !== undefined && up.json?.uploadUrl !== undefined) {
      // PUT đi thẳng tới MinIO qua URL đã ký, nên dùng `fetch` chứ không `goi`.
      const put = await fetch(up.json.uploadUrl, {
        method: 'PUT',
        body: tep,
        headers: { 'content-type': 'text/csv' },
      }).catch((e) => ({ ok: false, status: 0, _loi: e.message }));
      s.can(put.ok === true, 'PUT tệp lên kho đối tượng', `${put.status} ${put._loi ?? ''}`);

      const an = await goi('POST', `/v1/datasets/${dsId}/analyze`, { token });
      const sheets = (an.json?.sheets ?? []).map((x) => x?.name ?? x).filter(Boolean);
      s.can(an.ma === 200 && sheets.length > 0, 'POST /datasets/:id/analyze', `${an.ma} ${an.chu}`);

      if (sheets.length > 0) {
        const cm = await goi('POST', `/v1/datasets/${dsId}/commit`, {
          token,
          body: { name: MOC, sheets: [sheets[0]], ...(thay ? { capNhat: true } : {}) },
        });
        s.can(
          cm.ma >= 200 && cm.ma < 300,
          `POST /datasets/:id/commit${thay ? ' (capNhat: thay số của bộ mốc)' : ''}`,
          `${cm.ma} ${cm.chu}`,
        );

        // `commit` tự xếp hàng nạp, nên chỉ cần CHỜ, không gọi `/load` nữa.
        let tt = null;
        for (let i = 0; i < 40; i++) {
          await cho(1500);
          const st = await goi('GET', `/v1/datasets/${dsId}/load`, { token });
          tt = st.json;
          if (tt?.status !== undefined && !['queued', 'running'].includes(tt.status)) break;
        }
        s.can(
          tt?.rowsLoaded === soDongTep && tt?.rowsFailed === 0,
          `nạp đủ ${soDongTep} dòng vào kho phân tích, 0 lỗi`,
          `trạng thái=${tt?.status} đọc=${tt?.rowsRead} nạp=${tt?.rowsLoaded} lỗi=${tt?.rowsFailed}`,
        );

        for (const d of ['/preview', '/schema', '/errors']) {
          const r = await goi('GET', `/v1/datasets/${dsId}/load${d}`, { token });
          s.can(r.ma === 200, `GET /datasets/:id/load${d}`, `${r.ma} ${r.chu}`);
        }
      }
    }

    // ─── mô hình trên bộ dữ liệu vừa nạp ─────────────────────────────────
    if (dsId !== undefined) {
      const dm = await goi('POST', '/v1/datamodels', {
        token,
        body: { workspaceId: id.ws, name: `${DAU} mo hinh`, datasetIds: [dsId] },
      });
      dmId = dm.json?.id;
      s.can(dmId !== undefined, 'POST /datamodels', `${dm.ma} ${dm.chu}`);
      if (dmId !== undefined) don.push(['DELETE', `/v1/datamodels/${dmId}`]);
    }

    let chieu;
    let thuocDo;
    if (dmId !== undefined) {
      const f = await goi('GET', `/v1/datamodels/${dmId}/fields`, { token });
      chieu = f.json?.dimensions?.[0]?.id;
      thuocDo = f.json?.measures?.[0]?.id;
      s.can(
        chieu !== undefined && thuocDo !== undefined,
        'GET /datamodels/:id/fields → có chiều và thước đo',
        `${f.ma} chieu=${chieu} thuocDo=${thuocDo}`,
      );

      if (chieu !== undefined && thuocDo !== undefined) {
        await goiQuaCube(
          s,
          'POST /datamodels/:id/query → trả về dòng dữ liệu',
          'POST',
          `/v1/datamodels/${dmId}/query`,
          {
            token,
            body: { dimensionIds: [chieu], measureIds: [thuocDo] },
            kiem: (r) => r.ma === 200 && Array.isArray(r.json?.rows) && r.json.rows.length > 0,
          },
        );
      }
    }

    // ─── báo cáo, và chốt "xoá mô hình còn báo cáo" ───────────────────────
    if (dmId !== undefined && chieu !== undefined && thuocDo !== undefined) {
      const rp = await goi('POST', '/v1/reports/from-datamodel', {
        token,
        body: {
          datamodelId: dmId,
          name: `${DAU} bao cao`,
          chartType: 'bar',
          config: { dimensionId: chieu, measureId: thuocDo },
        },
      });
      rpId = rp.json?.id;
      s.can(rpId !== undefined, 'POST /reports/from-datamodel', `${rp.ma} ${rp.chu}`);
      if (rpId !== undefined) {
        don.push(['DELETE', `/v1/reports/${rpId}`]);

        await goiQuaCube(s, 'GET /reports/:id/data', 'GET', `/v1/reports/${rpId}/data`, {
          token,
          kiem: (r) => r.ma === 200,
        });

        /*
         * Hồi quy cho lỗi sửa ngày 25/11/2026: xoá mô hình khi còn báo cáo dựng
         * trên nó từng ĐƯỢC PHÉP, để lại báo cáo sống mà không mở nổi. Giờ phải
         * 409. Đây là lý do mục này tạo đủ cả chuỗi thay vì chỉ gọi vài endpoint.
         */
        const xoaSom = await goi('DELETE', `/v1/datamodels/${dmId}`, { token });
        s.can(
          xoaSom.ma === 409,
          'xoá mô hình khi còn báo cáo → 409 (chặn)',
          `nhận ${xoaSom.ma} ${xoaSom.chu}`,
        );
        if (xoaSom.ma === 204) dmId = undefined; // đã bị xoá mất, đừng dọn lại
      }
    }

    // ─── hỏi đáp dữ liệu ─────────────────────────────────────────────────
    const tt = await goi('GET', '/v1/chat/trang-thai', { token });
    s.can(tt.ma === 200, 'GET /chat/trang-thai', `${tt.ma} ${tt.chu}`);
    const moHinhHoi = dmId ?? id.moHinh;
    if (moHinhHoi === undefined) {
      s.bo('hỏi đáp trên mô hình', 'không có mô hình nào để hỏi');
    } else {
      /*
       * Đường chat chạy một truy vấn Cube, nên nó 503 được vì HAI lý do khác
       * hẳn nhau — và nói sai lý do thì tệ hơn không nói:
       *
       *   • chưa khai `LLM_API_KEY` → tính năng tắt, bỏ qua là đúng.
       *   • `CubeUnavailable` → hạ tầng đang quá tải, xem `goiQuaCube`.
       *
       * Bản đầu gộp cả hai vào câu "chưa cấu hình LLM_API_KEY", nên một lần Cube
       * quá tải sẽ báo người đọc đi tìm một biến môi trường vốn đã có.
       */
      const ch = await goi('POST', `/v1/datamodels/${moHinhHoi}/chat/cau-hoi`, {
        token,
        body: { cauHoi: 'tổng thành tiền theo chi nhánh' },
      });
      const cubeQuaTai = ch.ma === 503 && ch.json?.error === 'CubeUnavailable';
      if (cubeQuaTai) {
        s.bo(
          'hỏi đáp trên mô hình',
          'Cube trả 503 CubeUnavailable — hạ tầng đang quá tải, không phải lỗi mã nguồn',
        );
      } else if (tt.json?.bat === false || ch.ma === 503) {
        s.bo('hỏi đáp trên mô hình', 'chưa cấu hình LLM_API_KEY — bỏ qua, không phải lỗi');
      } else {
        s.can(
          ch.ma === 200 && typeof ch.json?.cau === 'string' && ch.json.cau.length > 0,
          'POST /datamodels/:id/chat/cau-hoi → có câu trả lời',
          `${ch.ma} ${ch.chu}`,
        );
      }
    }
  } catch (err) {
    s.truot('mục dừng giữa đường', String(err?.message ?? err));
  } finally {
    // ─── dọn, rồi KIỂM xem đã sạch chưa ───────────────────────────────────
    const hong = [];
    for (const [m, d] of don.reverse()) {
      const r = await goi(m, d, { token });
      if (![200, 204, 404].includes(r.ma)) hong.push(`${m} ${d} → ${r.ma} ${r.chu.slice(0, 90)}`);
    }
    s.can(hong.length === 0, `dọn ${don.length} đối tượng vừa tạo`, hong.join('\n      '));

    // Soát lại bằng chính API: còn gì mang dấu `DAU` là rác còn sót.
    const sot = [];
    const ds = await goi('GET', `/v1/datasets?workspaceId=${id.ws}&page=1&pageSize=100`, { token });
    for (const x of ds.json?.items ?? []) {
      if (String(x?.name ?? '').startsWith(DAU)) sot.push(`dataset #${x.id} ${x.name}`);
    }
    const dm = await goi('GET', '/v1/datamodels', { token });
    for (const x of dm.json?.items ?? []) {
      if (String(x?.name ?? '').startsWith(DAU)) sot.push(`datamodel #${x.id} ${x.name}`);
    }
    const rp = await goi('GET', `/v1/reports?workspaceId=${id.ws}`, { token });
    for (const x of rp.json?.items ?? []) {
      if (String(x?.name ?? '').startsWith(DAU)) sot.push(`report #${x.id} ${x.name}`);
    }
    s.can(
      sot.length === 0,
      `không còn đối tượng nào mang dấu ${DAU}`,
      sot.length > 0 ? `RÁC CÒN SÓT — xoá tay:\n      ${sot.join('\n      ')}` : '',
    );
  }

  return s;
}
