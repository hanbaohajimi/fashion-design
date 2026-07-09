import { useState } from 'react';
import { ArrowLeft, LockKeyhole, Mail, UserRound } from 'lucide-react';

interface AuthPageProps {
  onLogin: (user: { email: string; name: string; auth_token: string; expires_at: string }) => void;
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
      onLogin({
        email: data.email,
        name: data.name,
        auth_token: data.auth_token,
        expires_at: data.expires_at,
      });
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
      onLogin({
        email: data.email,
        name: data.name,
        auth_token: data.auth_token,
        expires_at: data.expires_at,
      });
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

  const inputClass = (hasError?: boolean) =>
    `auth-input pl-11 ${hasError ? 'border-[color:var(--color-danger)]' : ''}`;

  return (
    <div className="entry-shell">
      <main className="entry-frame">
        <div
          className="mx-auto grid w-full max-w-5xl items-stretch gap-12 lg:grid-cols-[1fr_460px]"
          style={{ minHeight: 'min(640px, 80vh)' }}
        >
          <section
            className="hidden lg:flex flex-col justify-between"
            style={{
              padding: '40px',
              background: 'var(--color-ink)',
              color: 'var(--color-canvas)',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div>
              <div
                className="kicker-rule"
                style={{ color: 'var(--color-canvas)', opacity: 0.85 }}
              >
                Atelier &middot; Members
              </div>

              <h1 className="headline headline-lg" style={{ marginTop: 32, color: 'var(--color-canvas)' }}>
                {mode === 'login' ? (
                  <>
                    Welcome
                    <br />
                    <em style={{ fontStyle: 'italic', color: 'rgba(245,242,236,0.55)' }}>back to studio.</em>
                  </>
                ) : (
                  <>
                    Open your
                    <br />
                    <em style={{ fontStyle: 'italic', color: 'rgba(245,242,236,0.55)' }}>private studio.</em>
                  </>
                )}
              </h1>

              <p
                className="lede"
                style={{
                  marginTop: 24,
                  color: 'rgba(245,242,236,0.78)',
                  maxWidth: '28rem',
                }}
              >
                项目、偏好、趋势锚点与素材库会被记住——
                让 AI 生成从一次性尝试，变成可持续的创作流程。
              </p>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                fontFamily: 'var(--font-ui)',
                fontSize: 11,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                color: 'rgba(245,242,236,0.6)',
              }}
            >
              <span>Vol. I</span>
              <span style={{ width: 1, height: 12, background: 'rgba(245,242,236,0.3)' }} />
              <span>Atelier Mono</span>
              <span style={{ width: 1, height: 12, background: 'rgba(245,242,236,0.3)' }} />
              <span>{mode === 'login' ? 'Sign in' : 'Sign up'}</span>
            </div>
          </section>

          <section
            className="surface-card w-full"
            style={{ padding: 'clamp(28px, 4vw, 44px)', display: 'flex', flexDirection: 'column' }}
          >
            <button
              type="button"
              onClick={onBack}
              className="btn-ghost"
              style={{ alignSelf: 'flex-start', marginBottom: 28, marginLeft: -10, height: 36, padding: '0 12px', fontSize: 12 }}
            >
              <ArrowLeft className="h-4 w-4" />
              返回首页
            </button>

            <p className="kicker">{mode === 'login' ? 'Account / Sign In' : 'Account / Register'}</p>

            <h2 className="headline headline-md" style={{ marginTop: 8 }}>
              {mode === 'login' ? '欢迎回来' : '创建账号'}
            </h2>

            <p className="dek" style={{ marginTop: 10, color: 'var(--color-ink-3)' }}>
              {mode === 'login' ? '继续你的设计上下文。' : '保留你的项目、生成历史与偏好。'}
            </p>

            <hr className="rule-thin" style={{ margin: '24px 0' }} />

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {mode === 'register' && (
                <div>
                  <div className="relative">
                    <UserRound
                      className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2"
                      style={{ color: 'var(--color-ink-3)' }}
                    />
                    <input
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="昵称"
                      className={inputClass(!!errors.name)}
                    />
                  </div>
                  {errors.name && (
                    <p style={{ marginTop: 6, fontSize: 11, color: 'var(--color-danger)', fontFamily: 'var(--font-ui)', letterSpacing: '0.04em' }}>
                      {errors.name}
                    </p>
                  )}
                </div>
              )}

              <div>
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2"
                    style={{ color: 'var(--color-ink-3)' }}
                  />
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="邮箱地址"
                    className={inputClass(!!errors.email)}
                  />
                </div>
                {errors.email && (
                  <p style={{ marginTop: 6, fontSize: 11, color: 'var(--color-danger)', fontFamily: 'var(--font-ui)', letterSpacing: '0.04em' }}>
                    {errors.email}
                  </p>
                )}
              </div>

              <div>
                <div className="relative">
                  <LockKeyhole
                    className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2"
                    style={{ color: 'var(--color-ink-3)' }}
                  />
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="密码"
                    className={inputClass(!!errors.password)}
                  />
                </div>
                {errors.password && (
                  <p style={{ marginTop: 6, fontSize: 11, color: 'var(--color-danger)', fontFamily: 'var(--font-ui)', letterSpacing: '0.04em' }}>
                    {errors.password}
                  </p>
                )}
                {mode === 'register' && password && (
                  <p
                    style={{
                      marginTop: 6,
                      fontSize: 11,
                      fontFamily: 'var(--font-ui)',
                      letterSpacing: '0.04em',
                      color: pwCheck.valid ? 'var(--color-success)' : 'var(--color-warning)',
                    }}
                  >
                    {pwCheck.message}
                  </p>
                )}
              </div>

              {mode === 'register' && (
                <div>
                  <div className="relative">
                    <LockKeyhole
                      className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2"
                      style={{ color: 'var(--color-ink-3)' }}
                    />
                    <input
                      type="password"
                      value={confirmPw}
                      onChange={e => setConfirmPw(e.target.value)}
                      placeholder="确认密码"
                      className={inputClass(!!errors.confirmPassword)}
                    />
                  </div>
                  {errors.confirmPassword && (
                    <p style={{ marginTop: 6, fontSize: 11, color: 'var(--color-danger)', fontFamily: 'var(--font-ui)', letterSpacing: '0.04em' }}>
                      {errors.confirmPassword}
                    </p>
                  )}
                </div>
              )}

              {submitError && (
                <div
                  style={{
                    border: '1px solid var(--color-danger)',
                    background: 'transparent',
                    padding: '10px 14px',
                    fontSize: 12,
                    color: 'var(--color-danger)',
                    fontFamily: 'var(--font-ui)',
                    letterSpacing: '0.02em',
                  }}
                >
                  {submitError}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full"
                style={{ marginTop: 8, height: 46, minHeight: 46 }}
              >
                {loading ? '处理中...' : mode === 'login' ? '登录' : '注册账号'}
              </button>
            </form>

            <p
              style={{
                marginTop: 28,
                textAlign: 'center',
                fontSize: 12,
                color: 'var(--color-ink-3)',
                fontFamily: 'var(--font-ui)',
                letterSpacing: '0.04em',
              }}
            >
              {mode === 'login' ? '还没有账号？' : '已有账号？'}
              <button
                type="button"
                onClick={() => {
                  setMode(mode === 'login' ? 'register' : 'login');
                  setErrors({});
                  setSubmitError('');
                }}
                style={{
                  marginLeft: 6,
                  fontWeight: 'var(--weight-medium)',
                  color: 'var(--color-ink)',
                  background: 'none',
                  border: 'none',
                  borderBottom: '1px solid var(--color-accent)',
                  paddingBottom: 1,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-ui)',
                  fontSize: 12,
                  letterSpacing: '0.04em',
                }}
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
