import {
  CONNECTION_KIND_DESCRIPTIONS,
  CONNECTION_KIND_LABELS,
  CONNECTION_KINDS,
  type ConnectionDto,
  type ConnectionKind,
  type TestConnectionResultDto,
} from '@bi/shared';
import { Fragment, useEffect, useState } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Field } from '../../../components/ui/Field';
import { getApiError } from '../../../services/apiClient';
import * as api from '../api';
import { useCreateConnection, usePrerequisites, useUpdateConnection } from '../hooks';

/**
 * Wizard thêm / sửa kết nối CSDL — §8.2.
 *
 * ─── Vì sao là TRANG, không phải hộp thoại ──────────────────────────────────
 *
 * Bản đầu dựng trong `Modal` và đó là lựa chọn sai. Hộp thoại của hệ thống rộng
 * 32rem — vừa cho một form xác nhận, chật cho ba bước có thẻ chọn loại CSDL, lưới
 * hai cột và một bảng tóm tắt. Hậu quả không chỉ là chật: khi lỗi kết nối hiện ra
 * ở bước 3, người dùng cần đọc nó CÙNG LÚC với thông tin họ đã nhập để biết sửa
 * gì, mà hộp thoại thì đẩy hai thứ đó ra hai màn cuộn khác nhau.
 *
 * Là trang thì mỗi bước có một URL thật, nút Back của trình duyệt hoạt động, và
 * form không bị kẹp trong một khung cố định.
 *
 * ─── Bước vẫn là state cục bộ, không phải route ─────────────────────────────
 *
 * Khác thanh tab của trang Quản lý tổ chức. Tab là ba MẶT của cùng một trang,
 * người dùng nhảy qua lại và cần deep-link. Wizard là một luồng TUYẾN TÍNH có
 * trạng thái dở dang: "bước 3 của một kết nối chưa lưu" không phải thứ gửi link
 * cho người khác được, và F5 giữa chừng thì mật khẩu vừa gõ cũng mất.
 *
 * ─── Luật quan trọng nhất: KHÔNG lưu khi chưa test xanh ─────────────────────
 *
 * Nút Lưu chỉ mở sau khi `POST /connections/test` trả `ok`. Lưu một kết nối chưa
 * từng chạy được là cất sẵn một thứ hỏng vào hệ thống — và nó sẽ hỏng lần đầu
 * tiên vào lúc có người đang cần đồng bộ gấp. Sửa BẤT KỲ trường nào cũng xoá kết
 * quả test, vì kết quả đó thuộc về đúng bộ thông tin đã thử.
 */

type Step = 1 | 2 | 3;

const STEP_TITLES: Record<Step, string> = {
  1: 'Chuẩn bị',
  2: 'Thông tin kết nối',
  3: 'Xác minh',
};

const STEPS: Step[] = [1, 2, 3];

const EMPTY: api.ConnectionFormValues = {
  name: '',
  kind: 'mysql',
  host: '',
  port: 3306,
  useSsl: false,
  databaseName: '',
  username: '',
  password: '',
};

interface ConnectionWizardProps {
  /** `null` = tạo mới. Khác null = sửa kết nối đang có. */
  editing: ConnectionDto | null;
  /** Gọi sau khi lưu xong, và khi người dùng bấm Huỷ. */
  onDone: () => void;
}

export function ConnectionWizard({
  editing,
  onDone,
}: ConnectionWizardProps): React.ReactElement {
  const isEdit = editing !== null;

  // Sửa thì nhảy thẳng bước 2: bước "Chuẩn bị" nói về việc mở tường lửa và cấp
  // quyền — những thứ đã làm xong từ lần tạo kết nối này.
  const [step, setStep] = useState<Step>(isEdit ? 2 : 1);
  const [values, setValues] = useState<api.ConnectionFormValues>(EMPTY);
  const [tested, setTested] = useState<TestConnectionResultDto | null>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const { data: prereq } = usePrerequisites();
  const create = useCreateConnection();
  const update = useUpdateConnection();

  // Nạp dữ liệu của kết nối đang sửa. Chạy lại khi `editing` đổi vì trang có thể
  // được mở thẳng bằng URL, lúc đó danh sách kết nối chưa về và `editing` là
  // `null` ở lần render đầu.
  useEffect(() => {
    if (!editing) return;
    setValues({
      name: editing.name,
      kind: editing.kind,
      host: editing.host,
      port: editing.port,
      useSsl: editing.useSsl,
      databaseName: editing.databaseName,
      username: editing.username,
      // Ô trống khi sửa: backend KHÔNG trả mật khẩu ra, và để trống nghĩa là giữ
      // nguyên. Điền một chuỗi giả vào đây sẽ khiến người dùng tưởng họ đang
      // thấy mật khẩu thật.
      password: '',
    });
    setTested(null);
  }, [editing]);

  function set<K extends keyof api.ConnectionFormValues>(
    key: K,
    value: api.ConnectionFormValues[K],
  ): void {
    setValues((prev) => ({ ...prev, [key]: value }));
    // Đổi bất kỳ trường nào là kết quả test cũ hết giá trị — nó thuộc về bộ
    // thông tin trước đó, không phải bộ đang hiện trên màn hình.
    setTested(null);
    setFieldErrors((prev) => ({ ...prev, [key]: '' }));
  }

  /**
   * Đổi loại CSDL kéo theo cổng và cờ SSL mặc định.
   *
   * Chỉ ghi đè khi người dùng CHƯA tự sửa cổng — nhận ra bằng cách xem cổng hiện
   * tại có phải là mặc định của một loại nào đó không. Không có phép thử này thì
   * người vừa gõ cổng riêng 9440 mà lỡ bấm nhầm thẻ loại sẽ mất con số đó.
   */
  function setKind(kind: ConnectionKind): void {
    const ports = prereq?.defaultPorts;
    const ssl = prereq?.defaultSsl;
    const untouchedPort = ports
      ? Object.values(ports).includes(values.port)
      : values.port === EMPTY.port;

    setValues((prev) => ({
      ...prev,
      kind,
      port: untouchedPort && ports ? ports[kind] : prev.port,
      useSsl: untouchedPort && ssl ? ssl[kind] : prev.useSsl,
    }));
    setTested(null);
  }

  async function runTest(): Promise<void> {
    setTesting(true);
    setError(null);
    setFieldErrors({});
    try {
      setTested(await api.testConnection(values));
    } catch (err) {
      const apiError = getApiError(err);
      if (apiError.fields) setFieldErrors(apiError.fields);
      setError(apiError.message);
    } finally {
      setTesting(false);
    }
  }

  function save(): void {
    setError(null);
    const onError = (err: unknown): void => {
      const apiError = getApiError(err);
      if (apiError.fields) {
        setFieldErrors(apiError.fields);
        // Lỗi gắn vào một ô cụ thể thì đưa người dùng về đúng bước có ô đó.
        setStep(2);
      }
      setError(apiError.message);
    };

    if (editing) {
      update.mutate({ id: editing.id, values }, { onSuccess: onDone, onError });
    } else {
      create.mutate(values, { onSuccess: onDone, onError });
    }
  }

  const saving = create.isPending || update.isPending;
  // Khi SỬA, mật khẩu để trống nghĩa là giữ nguyên — hợp lệ. Khi TẠO thì bắt buộc.
  const filled =
    values.name.trim() !== '' &&
    values.host.trim() !== '' &&
    values.databaseName.trim() !== '' &&
    values.username.trim() !== '' &&
    (isEdit || values.password !== '');

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <Stepper current={step} />

      <div className="border-t border-slate-200 px-6 py-7 sm:px-8">
        {error && (
          <p
            role="alert"
            className="mb-5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700"
          >
            {error}
          </p>
        )}

        {step === 1 && (
          <StepPrepare
            egressIp={prereq?.egressIp}
            grants={prereq?.grants[values.kind]}
            kind={values.kind}
            onKindChange={setKind}
          />
        )}

        {step === 2 && (
          <StepDetails
            values={values}
            fieldErrors={fieldErrors}
            isEdit={isEdit}
            onKindChange={setKind}
            onChange={set}
          />
        )}

        {step === 3 && (
          <StepVerify values={values} tested={tested} testing={testing} onTest={runTest} />
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4 sm:px-8">
        <Button onClick={() => (step === 1 || (isEdit && step === 2) ? onDone() : setStep((step - 1) as Step))}>
          {step === 1 || (isEdit && step === 2) ? 'Huỷ' : 'Quay lại'}
        </Button>

        {step < 3 ? (
          <Button
            variant="primary"
            onClick={() => setStep((step + 1) as Step)}
            disabled={step === 2 && !filled}
          >
            Tiếp tục
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={save}
            loading={saving}
            // Xem ghi chú "KHÔNG lưu khi chưa test xanh" ở đầu file.
            disabled={tested?.ok !== true}
          >
            {isEdit ? 'Lưu thay đổi' : 'Lưu kết nối'}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Thanh tiến trình ba bước.
 *
 * Bước đã qua hiện dấu tích chứ không hiện số: người dùng cần biết "xong rồi"
 * chứ không cần đọc lại thứ tự, và dấu tích là thứ duy nhất phân biệt được "đã
 * hoàn thành" với "đang ở đây" mà không cần nhìn màu — quan trọng với người
 * không phân biệt được màu sắc.
 */
function Stepper({ current }: { current: Step }): React.ReactElement {
  return (
    <ol className="flex items-center px-6 py-5 sm:px-8">
      {STEPS.map((step, index) => {
        const done = step < current;
        const active = step === current;

        return (
          <Fragment key={step}>
            {index > 0 && (
              <span
                aria-hidden="true"
                className="mx-3 h-px min-w-6 flex-1 border-t border-dashed border-slate-300"
              />
            )}
            <li
              className="flex shrink-0 items-center gap-2"
              aria-current={active ? 'step' : undefined}
            >
              <span
                className={[
                  'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
                  done || active ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-500',
                ].join(' ')}
              >
                {done ? <CheckIcon /> : step}
              </span>
              <span
                className={[
                  'text-sm',
                  active
                    ? 'font-semibold text-brand-700'
                    : done
                      ? 'font-medium text-slate-700'
                      : 'text-slate-400',
                ].join(' ')}
              >
                {STEP_TITLES[step]}
              </span>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

/**
 * Bước 1 — những việc phải làm ở PHÍA KHÁCH HÀNG trước khi kết nối chạy được.
 *
 * Đặt trước form là có chủ đích: hai lý do khiến kết nối thất bại nhiều nhất là
 * tường lửa chặn và tài khoản thiếu quyền, mà cả hai đều phải xử lý ở nơi khác
 * và mất thời gian chờ. Biết trước thì họ đi làm việc đó rồi quay lại; biết sau
 * thì họ đã gõ xong form và nhận một lỗi không hiểu.
 */
function StepPrepare({
  egressIp,
  grants,
  kind,
  onKindChange,
}: {
  egressIp: string | undefined;
  grants: string[] | undefined;
  kind: ConnectionKind;
  onKindChange: (kind: ConnectionKind) => void;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-7">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Trước khi bắt đầu</h2>
        <p className="mt-1 text-sm text-slate-500">
          Hai việc dưới đây làm ở phía CSDL của bạn, không phải ở đây — và chúng là nguyên nhân
          của gần như mọi lần kết nối thất bại.
        </p>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-900">1. Mở tường lửa cho IP này</h3>
        <p className="mt-1 text-sm text-slate-500">
          CSDL của bạn cần cho phép kết nối đến từ địa chỉ dưới đây.
        </p>
        <div className="mt-2.5 flex max-w-md items-center gap-2">
          <code className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700">
            {egressIp ?? '…'}
          </code>
          <Button
            size="sm"
            onClick={() => {
              if (!egressIp) return;
              // `catch` chứ không để Promise rơi tự do: clipboard bị từ chối khi
              // trang không chạy trên HTTPS hoặc người dùng đã chặn quyền, và
              // một lỗi chưa bắt ở đây sẽ hiện ra console như một sự cố.
              navigator.clipboard
                .writeText(egressIp)
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            {copied ? 'Đã chép' : 'Chép'}
          </Button>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-900">2. Cấp quyền cho tài khoản</h3>
        <p className="mt-1 text-sm text-slate-500">
          Hệ thống <strong>chỉ đọc</strong>, không bao giờ ghi vào CSDL của bạn. Quyền cần cấp
          khác nhau theo loại CSDL:
        </p>

        {/* Bộ chọn gọn ở đây, thẻ lớn ở bước 2 — cùng một state, nên đổi ở đâu
            cũng ăn sang chỗ kia. Bước 1 cần nó vì danh sách quyền ngay bên dưới
            phụ thuộc vào loại CSDL; dùng thẻ lớn ở cả hai chỗ sẽ khiến người
            dùng tưởng mình phải chọn hai lần. */}
        <div className="mt-3 inline-flex rounded-lg border border-slate-300 p-0.5">
          {CONNECTION_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onKindChange(k)}
              aria-pressed={k === kind}
              className={[
                'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
                k === kind ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900',
              ].join(' ')}
            >
              {CONNECTION_KIND_LABELS[k]}
            </button>
          ))}
        </div>

        <ul className="mt-3 space-y-1.5">
          {(grants ?? []).map((grant) => (
            <li key={grant} className="flex gap-2 text-sm text-slate-600">
              <span aria-hidden="true" className="text-brand-600">
                •
              </span>
              {grant}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Bước 2 — thông tin kết nối. */
function StepDetails({
  values,
  fieldErrors,
  isEdit,
  onKindChange,
  onChange,
}: {
  values: api.ConnectionFormValues;
  fieldErrors: Record<string, string>;
  isEdit: boolean;
  onKindChange: (kind: ConnectionKind) => void;
  onChange: <K extends keyof api.ConnectionFormValues>(
    key: K,
    value: api.ConnectionFormValues[K],
  ) => void;
}): React.ReactElement {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Thông tin kết nối</h2>
        <p className="mt-1 text-sm text-slate-500">
          Cung cấp chi tiết kết nối và thông tin đăng nhập của người dùng cơ sở dữ liệu riêng.
        </p>
      </div>

      <fieldset>
        <legend className="mb-2 block text-sm font-medium text-slate-700">Loại CSDL</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {CONNECTION_KINDS.map((kind) => (
            <KindCard
              key={kind}
              kind={kind}
              selected={kind === values.kind}
              onSelect={() => onKindChange(kind)}
            />
          ))}
        </div>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-[1fr_10rem]">
        <Field
          label="Máy chủ"
          placeholder="vd: db.example.com"
          value={values.host}
          error={fieldErrors['host']}
          onChange={(e) => onChange('host', e.target.value)}
        />
        <Field
          label="Cổng"
          type="number"
          value={String(values.port)}
          error={fieldErrors['port']}
          onChange={(e) => onChange('port', Number(e.target.value))}
        />
      </div>

      <SslToggle checked={values.useSsl} onChange={(v) => onChange('useSsl', v)} />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Database"
          placeholder={values.kind === 'clickhouse' ? 'vd: default' : 'Tên database'}
          value={values.databaseName}
          error={fieldErrors['databaseName']}
          onChange={(e) => onChange('databaseName', e.target.value)}
        />
        <Field
          label="Tài khoản"
          placeholder="Tài khoản CSDL"
          autoComplete="off"
          value={values.username}
          error={fieldErrors['username']}
          onChange={(e) => onChange('username', e.target.value)}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Mật khẩu"
          type="password"
          placeholder={isEdit ? 'Để trống nếu không đổi' : 'Mật khẩu CSDL'}
          autoComplete="new-password"
          revealable
          hint={isEdit ? 'Để trống nếu không muốn đổi mật khẩu hiện tại.' : undefined}
          value={values.password}
          error={fieldErrors['password']}
          onChange={(e) => onChange('password', e.target.value)}
        />
        <Field
          label="Tên kết nối"
          placeholder="vd: CSDL bán hàng"
          hint="Tên để bạn nhận ra nó trong danh sách."
          value={values.name}
          error={fieldErrors['name']}
          onChange={(e) => onChange('name', e.target.value)}
        />
      </div>
    </div>
  );
}

/**
 * Ô bật TLS.
 *
 * Là ô tick thật chứ không phải suy ra từ số cổng, vì đoán sai cho ra một lỗi
 * gần như không đọc được: máy chủ đóng phăng socket và Node báo "kết nối bị đặt
 * lại" — câu không nói được rằng chỉ cần tick một ô là xong.
 */
function SslToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}): React.ReactElement {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
      />
      <span>
        <span className="block text-sm font-medium text-slate-800">Dùng SSL/TLS</span>
        <span className="mt-0.5 block text-sm text-slate-500">
          Bắt buộc với CSDL chạy trên Internet. ClickHouse Cloud dùng cổng <code>8443</code> và
          chỉ nhận kết nối có SSL.
        </span>
      </span>
    </label>
  );
}

/** Bước 3 — bấm thử, và chỉ khi xanh mới cho lưu. */
function StepVerify({
  values,
  tested,
  testing,
  onTest,
}: {
  values: api.ConnectionFormValues;
  tested: TestConnectionResultDto | null;
  testing: boolean;
  onTest: () => void;
}): React.ReactElement {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Xác minh kết nối</h2>
        <p className="mt-1 text-sm text-slate-500">
          Hệ thống sẽ mở một kết nối thật tới máy chủ của bạn và đọc phiên bản.
        </p>
      </div>

      <dl className="max-w-xl rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
        {[
          ['Loại', CONNECTION_KIND_LABELS[values.kind]],
          ['Máy chủ', `${values.host}:${values.port}`],
          ['SSL/TLS', values.useSsl ? 'Bật' : 'Tắt'],
          ['Database', values.databaseName],
          ['Tài khoản', values.username],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 py-0.5">
            <dt className="text-slate-500">{label}</dt>
            <dd className="truncate font-medium text-slate-800">{value}</dd>
          </div>
        ))}
      </dl>

      <Button variant="primary" onClick={onTest} loading={testing}>
        Kiểm tra kết nối
      </Button>

      {tested?.ok === true && (
        <div className="max-w-xl rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-3">
          <Badge tone="success">Kết nối thành công</Badge>
          <p className="mt-1.5 text-sm text-emerald-800">
            Máy chủ trả về: <code className="text-xs">{tested.serverVersion}</code>
          </p>
        </div>
      )}

      {tested?.ok === false && (
        <div
          role="alert"
          className="max-w-xl rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700"
        >
          {/* Thông báo do backend dịch sẵn sang câu nói được phải sửa gì — không
              phải chuỗi lỗi thô của thư viện. Xem services/connections/explainError.ts */}
          {tested.message}
        </div>
      )}

      {tested === null && !testing && (
        <p className="max-w-xl text-sm text-slate-500">
          Phải kiểm tra thành công thì mới lưu được. Kết nối chưa từng chạy được mà đã lưu thì
          chỉ hỏng vào lúc có người đang cần dùng.
        </p>
      )}
    </div>
  );
}

/** Thẻ chọn loại CSDL — nút thật, không phải div bắt sự kiện click. */
function KindCard({
  kind,
  selected,
  onSelect,
}: {
  kind: ConnectionKind;
  selected: boolean;
  onSelect: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={[
        'relative rounded-xl border p-4 text-left transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-brand-200',
        selected
          ? 'border-brand-500 ring-1 ring-brand-500'
          : 'border-slate-200 hover:border-slate-300',
      ].join(' ')}
    >
      {selected && (
        <span aria-hidden="true" className="absolute right-3 top-3 text-brand-600">
          <CheckCircleIcon />
        </span>
      )}
      <KindLogo kind={kind} />
      <span className="mt-3 block font-medium text-slate-900">
        {CONNECTION_KIND_LABELS[kind]}
      </span>
      <span className="mt-0.5 block text-sm text-slate-500">
        {CONNECTION_KIND_DESCRIPTIONS[kind]}
      </span>
    </button>
  );
}

/* Logo vẽ inline thay vì nhúng ảnh: hai hình đơn giản, còn một thẻ <img> trỏ ra
   máy chủ ngoài thì vừa thêm một request vừa báo cho bên đó biết người dùng đang
   mở trang nào. Màu lấy theo nhận diện chính thức của từng sản phẩm. */

function KindLogo({ kind }: { kind: ConnectionKind }): React.ReactElement {
  return kind === 'clickhouse' ? <ClickHouseMark /> : <MysqlMark />;
}

function ClickHouseMark(): React.ReactElement {
  return (
    <svg className="h-8 w-8" viewBox="0 0 24 24" aria-hidden="true">
      {/* Bốn cột cao + một ô vuông nhỏ — đúng hình khối của nhận diện ClickHouse. */}
      {[1, 5.5, 10, 14.5].map((x) => (
        <rect key={x} x={x} y="2" width="3.2" height="20" rx="0.4" fill="#FAFF69" />
      ))}
      <rect x="19" y="10.4" width="3.2" height="3.2" rx="0.4" fill="#FAFF69" />
    </svg>
  );
}

function MysqlMark(): React.ReactElement {
  return (
    <svg className="h-8 w-8" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6v12c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2V6" fill="#00758F" />
      <ellipse cx="12" cy="12" rx="8" ry="3.2" fill="#005D73" />
      <ellipse cx="12" cy="6" rx="8" ry="3.2" fill="#F29111" />
    </svg>
  );
}

function CheckIcon(): React.ReactElement {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      aria-hidden="true"
    >
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}

function CheckCircleIcon(): React.ReactElement {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </svg>
  );
}
