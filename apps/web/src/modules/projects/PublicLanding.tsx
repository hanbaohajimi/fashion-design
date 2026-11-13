"use client";

import Link from "next/link";

import { BrandLockup } from "../../components/BrandLockup";
import styles from "./public-landing.module.css";

const QUICK_STARTS = [
  {
    id: "collection",
    title: "从一件外套开始做完整系列",
    description: "先定廓形，再把面料、色彩和搭配一起整理进白板。",
    href: "/login?starter=collection",
  },
  {
    id: "material",
    title: "把一块面料变成设计语言",
    description: "从触感和纹理出发，建立可继续扩展的材质档案。",
    href: "/login?starter=material",
  },
  {
    id: "lookbook",
    title: "为品牌做一组视觉提案",
    description: "收集参考、比较方向，再把最有潜力的一版推到交付。",
    href: "/login?starter=lookbook",
  },
] as const;

const CAPABILITIES = [
  {
    id: "canvas",
    title: "无限画布",
    description: "把需求、参考图和生成结果放在同一块白板，每个决策都有来源。",
  },
  {
    id: "ai",
    title: "AI 对话创作",
    description: "在左侧助手里描述方向，实时生成服装方案，所有候选保留血缘。",
  },
  {
    id: "collection",
    title: "系列 DNA",
    description: "从一张主图提炼系列基因，批量生成同调的 Look，一致性可量化。",
  },
  {
    id: "studio",
    title: "款式与交付",
    description: "款式档案、技术包、印花工台、走秀生成，从设计到交付一体化。",
  },
  {
    id: "trends",
    title: "趋势发现",
    description: "内置趋势库，直接导入画布作为参考节点，不再复制粘贴截图。",
  },
  {
    id: "review",
    title: "团队评审",
    description: "分享链接、版本绑定意见、样衣反馈，确认有据不漂在聊天里。",
  },
] as const;

const STEPS = [
  {
    step: "01",
    title: "描述想法",
    description: "写下设计目标，带入趋势、面料或参考图。",
  },
  {
    step: "02",
    title: "AI 生成方案",
    description: "对话式生成，比较候选，每个结果都保留来源链路。",
  },
  {
    step: "03",
    title: "整理交付",
    description: "款式确认后推进技术包、系列规划和导出文件。",
  },
] as const;

export function PublicLanding() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brandLink} href="/" aria-label="森织设计工作室首页">
          <BrandLockup size={42} />
        </Link>
        <nav aria-label="公开页面导航" className={styles.nav}>
          <a href="#how-it-works">工作方式</a>
          <a href="#capabilities">平台能力</a>
          <Link className={styles.loginLink} href="/login">
            登录
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className={styles.hero} aria-labelledby="landing-title">
        <div className={styles.heroCopy}>
          <h1 id="landing-title">
            让每一版服装方案
            <br />
            <em>都有来处。</em>
          </h1>
          <p className={styles.heroLead}>
            把需求、参考、生成结果和交付资料放进同一条可以继续的创作链路。
            作品先行，过程可查，确认有据。
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryAction} href="/login">
              立即开始，免费使用
              <span aria-hidden="true">↗</span>
            </Link>
            <a className={styles.quietAction} href="#how-it-works">
              先看工作方式
            </a>
          </div>
          <p className={styles.heroNote}>面向持续创作的服装设计工作区</p>
        </div>

        <div className={styles.heroArtifact} aria-label="从设计简报到交付的工作流预览">
          <div className={styles.artifactTopline}>
            <span>森织 / ATELIER</span>
            <span>工作流预览</span>
          </div>
          <div className={styles.artifactTitle}>
            <span>DESIGN BRIEF</span>
            <strong>秋冬通勤外套系列</strong>
          </div>
          <div className={styles.artifactBody}>
            <div className={styles.artifactColumn}>
              <span className={styles.artifactLabel}>本轮目标</span>
              <p>轻量、防风、低饱和；先确认廓形和面料方向。</p>
            </div>
            <div className={styles.artifactColumn}>
              <span className={styles.artifactLabel}>设计状态</span>
              <ul>
                <li><i data-state="done" />需求已整理</li>
                <li><i data-state="active" />方案待比较</li>
                <li><i />人工确认后交付</li>
              </ul>
            </div>
          </div>
          <div className={styles.artifactRail} aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className={styles.artifactBottomline}>
            <span>要求 / 参考 / 方案 / 修订</span>
            <span>继续工作 ↗</span>
          </div>
        </div>
      </section>

      {/* 三步说明 */}
      <section className={styles.stepsSection} id="how-it-works" aria-labelledby="steps-title">
        <h2 id="steps-title" className={styles.sectionTitle}>三步开始创作</h2>
        <div className={styles.stepsList}>
          {STEPS.map((item) => (
            <div className={styles.stepItem} key={item.step}>
              <span className={styles.stepNumber}>{item.step}</span>
              <h3 className={styles.stepTitle}>{item.title}</h3>
              <p className={styles.stepDesc}>{item.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Quick Start */}
      <section className={styles.quickStartSection} aria-labelledby="qs-title">
        <div className={styles.quickStartHeader}>
          <h2 id="qs-title">选一个方向，直接开始</h2>
          <p>每个入口都会创建真实项目，之后可以继续补充参考、款式和交付资料。</p>
        </div>
        <div className={styles.quickStartGrid}>
          {QUICK_STARTS.map((item) => (
            <Link
              className={styles.quickStartCard}
              href={item.href}
              key={item.id}
            >
              <strong className={styles.quickStartTitle}>{item.title}</strong>
              <p className={styles.quickStartDesc}>{item.description}</p>
              <span aria-hidden="true" className={styles.quickStartArrow}>↗</span>
            </Link>
          ))}
        </div>
      </section>

      {/* 能力矩阵 */}
      <section className={styles.capabilitiesSection} id="capabilities" aria-labelledby="cap-title">
        <h2 id="cap-title" className={styles.sectionTitle}>完整设计工作区</h2>
        <div className={styles.capabilitiesGrid}>
          {CAPABILITIES.map((cap) => (
            <div className={styles.capabilityCard} key={cap.id}>
              <strong>{cap.title}</strong>
              <p>{cap.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className={styles.finalCta} aria-labelledby="cta-title">
        <div>
          <h2 id="cta-title">从下一件衣服开始。</h2>
          <p>先写下设计目标，再把它变成一条可以继续的工作流。</p>
        </div>
        <Link className={styles.primaryAction} href="/login">
          开始设计
          <span aria-hidden="true">↗</span>
        </Link>
      </section>

      <footer className={styles.footer}>
        <BrandLockup size={30} />
        <span>森织设计工作室 · 让每一版都有来处</span>
      </footer>
    </main>
  );
}

