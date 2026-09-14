import { beforeEach, describe, expect, it } from 'vitest';
import { beginAppSession, type AppSessionEnv } from '../src/auth/appSession';
import { readToken, writeToken } from '../src/auth/tokenStorage';

/**
 * Bản giả của `sessionStorage` cho MỘT tab. Hai tab là hai bản giả khác nhau;
 * F5 là chạy lại trên CÙNG một bản giả.
 */
function tab(): NonNullable<AppSessionEnv['tab']> {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
  };
}

/**
 * Bản giả của `navigator.locks` cho MỘT trình duyệt: mọi tab dùng chung một
 * bản. `request` ghi khoá vào danh sách NGAY LẬP TỨC — nên nếu code giữ khoá
 * trước rồi mới hỏi, nó sẽ thấy chính mình, và ca "mở một mình" sẽ đỏ.
 */
function browser(othersHolding: string[] = []) {
  const held = [...othersHolding];
  const calls: string[] = [];
  const locks = {
    query: async () => {
      calls.push('query');
      return { held: held.map((name) => ({ name, mode: 'shared', clientId: 'x' })), pending: [] };
    },
    request: (name: string) => {
      calls.push('request');
      held.push(name);
      return new Promise<never>(() => {});
    },
  } as unknown as NonNullable<AppSessionEnv['locks']>;
  return { locks, calls };
}

const SNAPSHOT_KEY = 'bi.qs2.bao-cao-cu';

beforeEach(() => {
  window.localStorage.clear();
});

describe('beginAppSession — đóng app là hết phiên', () => {
  it('mở app khi không còn tab nào: xoá token và ảnh chụp số liệu của phiên cũ', async () => {
    writeToken('token-tu-hom-qua');
    window.localStorage.setItem(SNAPSHOT_KEY, '{"at":1,"data":[]}');

    const start = await beginAppSession({ tab: tab(), locks: browser().locks });

    expect(start).toBe('fresh');
    expect(readToken()).toBeNull();
    expect(window.localStorage.getItem(SNAPSHOT_KEY)).toBeNull();
  });

  it('F5: giữ phiên, dù trang cũ đã nhả khoá trước khi trang mới kịp hỏi', async () => {
    const motTab = tab();
    await beginAppSession({ tab: motTab, locks: browser().locks });
    writeToken('token-vua-dang-nhap');
    window.localStorage.setItem(SNAPSHOT_KEY, '{"at":1,"data":[]}');

    // Tải lại: CÙNG sessionStorage, nhưng không còn ai giữ khoá.
    const start = await beginAppSession({ tab: motTab, locks: browser().locks });

    expect(start).toBe('resumed');
    expect(readToken()).toBe('token-vua-dang-nhap');
    // Ảnh chụp là thứ làm báo cáo mở ngay — F5 mà xoá nó là chậm vô cớ.
    expect(window.localStorage.getItem(SNAPSHOT_KEY)).not.toBeNull();
  });

  it('tab mới khi app đang mở ở tab khác: vào luôn, không bắt đăng nhập lại', async () => {
    const trinhDuyet = browser();
    await beginAppSession({ tab: tab(), locks: trinhDuyet.locks });
    writeToken('token-cua-tab-dau');

    const start = await beginAppSession({ tab: tab(), locks: trinhDuyet.locks });

    expect(start).toBe('joined');
    expect(readToken()).toBe('token-cua-tab-dau');
  });

  it('HỎI trước rồi mới GIỮ khoá — đảo lại thì tab thấy chính mình và không đăng xuất ai', async () => {
    writeToken('token-cu');
    const trinhDuyet = browser();

    await beginAppSession({ tab: tab(), locks: trinhDuyet.locks });

    expect(trinhDuyet.calls).toEqual(['query', 'request']);
    expect(readToken()).toBeNull();
  });

  it('một khoá của thứ khác cùng origin không được tính là app đang mở', async () => {
    writeToken('token-cu');

    const start = await beginAppSession({ tab: tab(), locks: browser(['khoa-khac']).locks });

    expect(start).toBe('fresh');
    expect(readToken()).toBeNull();
  });

  it('không có Web Locks (HTTP trên địa chỉ IP): tab mới phải đăng nhập lại, F5 vẫn giữ', async () => {
    const motTab = tab();
    await beginAppSession({ tab: motTab, locks: null });
    writeToken('token');

    expect(await beginAppSession({ tab: motTab, locks: null })).toBe('resumed');
    expect(readToken()).toBe('token');

    expect(await beginAppSession({ tab: tab(), locks: null })).toBe('fresh');
    expect(readToken()).toBeNull();
  });

  it('`locks.query()` hỏng: vẫn xong, và hỏng theo hướng chặt hơn', async () => {
    writeToken('token-cu');
    const locks = {
      query: () => Promise.reject(new Error('SecurityError')),
      request: () => {
        throw new Error('SecurityError');
      },
    } as unknown as NonNullable<AppSessionEnv['locks']>;

    await expect(beginAppSession({ tab: tab(), locks })).resolves.toBe('fresh');
    expect(readToken()).toBeNull();
  });

  it('`sessionStorage` bị chặn hẳn: không ném — `main.tsx` chỉ render sau khi hàm này xong', async () => {
    const chan = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    };

    await expect(beginAppSession({ tab: chan, locks: browser().locks })).resolves.toBe('fresh');
  });
});
