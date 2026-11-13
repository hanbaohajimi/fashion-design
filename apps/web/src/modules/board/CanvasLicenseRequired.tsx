import styles from "./canvas-license.module.css";

export function CanvasLicenseRequired({ compact = false }: { readonly compact?: boolean }) {
  return (
    <section
      aria-label="画布授权配置"
      className={`${styles.surface} ${compact ? styles.compact : ""}`}
      data-canvas-license-required
      role="alert"
    >
      <div className={styles.mark} aria-hidden="true">S</div>
      <h1>画布授权尚未配置</h1>
      <p>
        生产环境需要有效的 tldraw 授权才能打开无限画布。请在部署配置中提供
        <code>NEXT_PUBLIC_TLDRAW_LICENSE_KEY</code>，然后重新构建 Web 应用。
      </p>
      <small>当前设计资料仍保留在项目中，配置完成后可以继续编辑。</small>
    </section>
  );
}
