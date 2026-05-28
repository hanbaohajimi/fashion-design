import { useState } from 'react';
import { ArrowLeft, LockKeyhole, Mail, UserRound } from 'lucide-react';

interface AuthPageProps {
  onLogin: (user: { email: string; name: string; auth_token: string }) => void;
  onBack: () => void;
}

type AuthMode = 'login' | 'register';

interface FormErrors {
  email?: string;
  password?: string;
  confirmPassword?: string;
  name?: string;
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(pw: string): { valid: boolean; message: string } {
  if (pw.length < 8) return { valid: false, message: '至少 8 个字符' };
  if (!/[a-zA-Z]/.test(pw)) return { valid: false, message: '需包含字母' };
  if (!/[0-9]/.test(pw)) return { valid: false, message: '需包含数字' };
  return { valid: true, message: '密码强度符合要求' };
}

export default function AuthPage({ onLogin, onBack }: AuthPageProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState('');
  const [loading, setLoading] = useState(false);

  const pwCheck = validatePassword(password);

  const handleLogin = async () => {
    setSubmitError('');
    const errs: FormErrors = {};
    if (!email.trim()) errs.email = '请输入邮箱';
    else if (!validateEmail(email)) errs.email = '邮箱格式不正确';
    if (!password) errs.password = '请输入密码';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setLoading(true);
    try {
      const res = await fetch('/api/design/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.toLowerCase().trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.detail || '登录失败');
        return;
      }
      onLogin({ email: data.email, name: data.name, auth_token: data.auth_token });
    } catch {
      setSubmitError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    setSubmitError('');
    const errs: FormErrors = {};
    if (!name.trim()) errs.name = '请输入昵称';
    if (!email.trim()) errs.email = '请输入邮箱';
    else if (!validateEmail(email)) errs.email = '邮箱格式不正确';
    if (!password) errs.password = '请输入密码';
    else if (!pwCheck.valid) errs.password = pwCheck.message;
    if (password !== confirmPw) errs.confirmPassword = '两次密码不一致';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setLoading(true);
    try {
      const res = await fetch('/api/design/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.toLowerCase().trim(), name: name.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.detail || '注册失败');
        return;
      }
      onLogin({ email: data.email, name: data.name, auth_token: data.auth_token });
    } catch {
      setSubmitError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void (mode === 'login' ? handleLogin() : handleRegister());
  };

  const fieldClass = (hasError?: boolean) =>
    `auth-input pl-11 ${hasError ? 'border-[color:var(--color-danger)]' : ''}`;

  return (
    <div className="entry-shell">
      <div
        className="entry-media"
        style={{ backgroundImage: 'url(https://picsum.photos/id/1048/1920/1280)' }}
      />
      <div className="entry-overlay" />

      <main className="entry-frame">
        <div className="mx-auto grid w-full max-w-5xl items-center gap-8 lg:grid-cols-[0.9fr_420px]">
          <section className="hidden lg:block text-white">
            <p className="hero-kicker w-max">
              <LockKeyhole className="h-3.5 w-3.5" />
              Secure creative workspace
            </p>
            <h1 className="mt-5 text-5xl font-extrabold leading-[0.98] tracking-[-0.03em]">
              登录后继续你的设计上下文
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-8 text-white/72">
              系统会保留项目、偏好、趋势锚点和素材库，让 AI 生成从一次性尝试变成可持续的创作流程。
            </p>
          </section>

          <section className="surface-card w-full p-6 md:p-8">
            <button type="button" onClick={onBack} className="btn-ghost mb-6 -ml-2 h-10 min-h-10 px-3 text-[13px]">
              <ArrowLeft className="h-4 w-4" />
              返回首页
            </button>

            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 'var(--weight-light)', letterSpacing: 'var(--tracking-tight)', color: 'var(--color-ink)' }}>
              {mode === 'login' ? '欢迎回来' : '创建账号'}
            </h2>
            <p style={{ marginTop: 8, fontSize: 'var(--text-sm)', lineHeight: 'var(--leading-normal)', color: 'var(--color-ink-2)', fontFamily: 'var(--font-ui)' }}>
              {mode === 'login' ? '进入你的 AI 时尚设计工作台。' : '创建账号后即可保存项目和生成历史。'}
            </p>

            <form onSubmit={handleSubmit} className="mt-7 space-y-4">
              {mode === 'register' && (
                <div>
                  <div className="relative">
                    <UserRound className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--color-ink-3)' }} />
                    <input
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="昵称"
                      className={fieldClass(!!errors.name)}
                    />
                  </div>
                  {errors.name && <p style={{ marginTop: 6, fontSize: 'var(--text-xs)', color: 'var(--color-danger)', fontFamily: 'var(--font-ui)' }}>{errors.name}</p>}
                </div>
              )}

              <div>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--color-ink-3)' }} />
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="邮箱地址"
                    className={fieldClass(!!errors.email)}
                  />
                </div>
                {errors.email && <p style={{ marginTop: 6, fontSize: 'var(--text-xs)', color: 'var(--color-danger)', fontFamily: 'var(--font-ui)' }}>{errors.email}</p>}
              </div>

              <div>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--color-ink-3)' }} />
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="密码"
                    className={fieldClass(!!errors.password)}
                  />
                </div>
                {errors.password && <p style={{ marginTop: 6, fontSize: 'var(--text-xs)', color: 'var(--color-danger)', fontFamily: 'var(--font-ui)' }}>{errors.password}</p>}
                {mode === 'register' && password && (
                  <p style={{ marginTop: 6, fontSize: 'var(--text-xs)', fontFamily: 'var(--font-ui)', color: pwCheck.valid ? 'var(--color-success)' : 'var(--color-warning)' }}>
                    {pwCheck.message}
                  </p>
                )}
              </div>

              {mode === 'register' && (
                <div>
                  <div className="relative">
                    <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--color-ink-3)' }} />
                    <input
                      type="password"
                      value={confirmPw}
                      onChange={e => setConfirmPw(e.target.value)}
                      placeholder="确认密码"
                      className={fieldClass(!!errors.confirmPassword)}
                    />
                  </div>
                  {errors.confirmPassword && <p style={{ marginTop: 6, fontSize: 'var(--text-xs)', color: 'var(--color-danger)', fontFamily: 'var(--font-ui)' }}>{errors.confirmPassword}</p>}
                </div>
              )}

              {submitError && (
                <div style={{ borderRadius: 'var(--radius-md)', border: '1px solid rgba(168,88,88,0.3)', background: 'rgba(168,88,88,0.1)', padding: '10px 16px', textAlign: 'center', fontSize: 'var(--text-sm)', color: 'var(--color-danger)', fontFamily: 'var(--font-ui)' }}>
                  {submitError}
                </div>
              )}

              <button type="submit" disabled={loading} className="btn-primary w-full font-semibold disabled:opacity-55">
                {loading ? '处理中...' : mode === 'login' ? '登录' : '注册'}
              </button>
            </form>

            <p style={{ marginTop: 24, textAlign: 'center', fontSize: 'var(--text-sm)', color: 'var(--color-ink-3)', fontFamily: 'var(--font-ui)' }}>
              {mode === 'login' ? '还没有账号？' : '已有账号？'}
              <button
                type="button"
                onClick={() => {
                  setMode(mode === 'login' ? 'register' : 'login');
                  setErrors({});
                  setSubmitError('');
                }}
                style={{ marginLeft: 4, fontWeight: 'var(--weight-medium)', color: 'var(--color-gold)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 'var(--text-sm)' }}
              >
                {mode === 'login' ? '立即注册' : '返回登录'}
              </button>
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
