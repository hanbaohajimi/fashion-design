"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type RefObject } from "react";

import heroPhoto from "../../../assets/plates/hero-photo.png";
import materialPhoto from "../../../assets/plates/material-photo.png";
import sketchPhoto from "../../../assets/plates/sketch-photo.png";
import collectionPhoto from "../../../assets/plates/collection-photo.png";
import { BrandLockup } from "../../components/BrandLockup";
import styles from "./public-landing.module.css";

const NAVIGATION = [
  { href: "#inspiration", label: "作品与灵感" },
  { href: "#process", label: "创作方式" },
  { href: "#tools", label: "设计工具" },
] as const;

const LOOKS = [
  {
    label: "自然肌理",
    title: "让材质，成为设计的起点。",
    description:
      "柔和的象牙白、宽松的体积与自然垂落的衣褶，让一件外套有了自己的语言。",
    material: "羊毛感肌理",
    silhouette: "宽松包裹廓形",
    color: "#d9d1be",
    focus: 0.25,
    alt: "象牙白系带外套的 AI 设计示例",
  },
  {
    label: "流动廓形",
    title: "让轮廓，跟着想法流动。",
    description:
      "从一块鼠尾草绿的面料出发，探索褶皱、层次和不对称的下摆，让同一份灵感继续展开。",
    material: "轻盈褶皱质感",
    silhouette: "不对称层叠廓形",
    color: "#87927a",
    focus: 0.51,
    alt: "鼠尾草绿层叠连衣裙的 AI 设计示例",
  },
  {
    label: "克制色彩",
    title: "用更少的色彩，表达更多。",
    description:
      "炭灰色与清晰的剪裁相遇。把注意力留给肩线、比例与结构，寻找系列中的另一种平衡。",
    material: "挺括织物质感",
    silhouette: "结构化剪裁",
    color: "#41433c",
    focus: 0.77,
    alt: "炭灰色结构外套的 AI 设计示例",
  },
] as const;

const FEATURES = [
  {
    icon: "conversation",
    title: "和 AI 一起，梳理设计方向",
    description: "带入想法与参考，说清楚想保留的部分，再继续生成、比较和修改。",
  },
  {
    icon: "material",
    title: "让面料与色彩，继续生长",
    description: "收集面料图片，尝试配色与印花，把值得发展的方向留在项目中。",
  },
  {
    icon: "collection",
    title: "围绕作品，建立完整系列",
    description: "在同一张画布里整理方案，保留来源、版本与每一次明确的选择。",
  },
  {
    icon: "delivery",
    title: "从设计，走向展示与交付",
    description: "将选定款式继续用于商品展示、系列规划、技术包与团队评审。",
  },
] as const;

const STARTERS = [
  {
    label: "以面料开始",
    description: "从一块喜欢的材质出发",
    href: "/login?starter=material",
  },
  {
    label: "做一个系列",
    description: "把一个方向延展成完整表达",
    href: "/login?starter=collection",
  },
  {
    label: "准备视觉提案",
    description: "整理下一次展示的想法",
    href: "/login?starter=lookbook",
  },
] as const;

function Arrow({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 12h16m-6-6 6 6-6 6" />
    </svg>
  );
}

function FeatureIcon({ name }: { name: string }) {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "conversation" ? (
        <>
          <path d="M4 4h16v12H9l-5 4Z" />
          <path d="M8 8h8m-8 4h5" />
        </>
      ) : name === "material" ? (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 3v18m6-18v18M3 9h18M3 15h18" />
        </>
      ) : name === "collection" ? (
        <>
          <path d="m3 7 9-5 9 5-9 5Zm0 5 9 5 9-5M3 17l9 5 9-5" />
        </>
      ) : (
        <>
          <path d="M4 10v10h16V10M12 16V2m-5 5 5-5 5 5" />
        </>
      )}
    </svg>
  );
}

function useLandingReveals(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = root.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const targets = [...element.querySelectorAll<HTMLElement>("[data-reveal]")];
    let observer: IntersectionObserver | null = null;
    const synchronize = () => {
      observer?.disconnect();
      if (media.matches) {
        targets.forEach((target) => {
          target.dataset.revealed = "true";
        });
        return;
      }
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries)
            if (entry.isIntersecting) {
              (entry.target as HTMLElement).dataset.revealed = "true";
              observer?.unobserve(entry.target);
            }
        },
        { threshold: 0.08 },
      );
      for (const target of targets) {
        if (target.dataset.revealed === "true") continue;
        if (target.getBoundingClientRect().top < innerHeight * 0.95)
          target.dataset.revealed = "true";
        else {
          target.dataset.revealed = "false";
          observer.observe(target);
        }
      }
    };
    synchronize();
    media.addEventListener("change", synchronize);
    return () => {
      observer?.disconnect();
      media.removeEventListener("change", synchronize);
    };
  }, [root]);
}

function LandingHeader() {
  const [open, setOpen] = useState(false);
  const header = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const navId = useId();
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!header.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setOpen(false);
      toggle.current?.focus();
    };
    const media = matchMedia("(min-width: 901px)");
    const closeAtDesktop = () => {
      if (media.matches) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    media.addEventListener("change", closeAtDesktop);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
      media.removeEventListener("change", closeAtDesktop);
    };
  }, [open]);
  const followAnchor = (href: string) => {
    setOpen(false);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(href)?.focus({ preventScroll: true }),
    );
  };
  const navigationLinks = NAVIGATION.map((item) => (
    <a key={item.href} href={item.href} onClick={() => followAnchor(item.href)}>
      {item.label}
    </a>
  ));
  return (
    <header
      ref={header}
      className={styles.header}
      onBlur={(event) => {
        if (
          open &&
          !event.currentTarget.contains(event.relatedTarget as Node | null)
        )
          setOpen(false);
      }}
    >
      <Link
        href="/"
        className={styles.brandLink}
        aria-label="森织设计工作室首页"
      >
        <BrandLockup size={42} className={styles.brand} />
      </Link>
      <nav className={styles.nav} aria-label="公开页面导航">
        <div className={styles.navLinks}>{navigationLinks}</div>
        <Link className={styles.loginLink} href="/login">
          登录
        </Link>
        <button
          ref={toggle}
          className={styles.navToggle}
          type="button"
          aria-label="页面导航"
          aria-expanded={open}
          aria-controls={navId}
          onClick={() => setOpen((value) => !value)}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d={open ? "m6 6 12 12M6 18 18 6" : "M4 8h16M4 16h16"} />
          </svg>
        </button>
        <div
          id={navId}
          className={[styles.navLinks, styles.mobileNavLinks].join(" ")}
          data-open={open}
        >
          {navigationLinks}
        </div>
      </nav>
    </header>
  );
}

function ProcessSection() {
  return (
    <section id="process" tabIndex={-1} className={styles.process}>
      <div className={styles.sectionHeading} data-reveal>
        <h2>从一块面料，到一个系列</h2>
        <p>把材料、轮廓与想象，接成一条可以继续的设计路径。</p>
      </div>
      <div className={styles.processVisuals}>
        <figure data-reveal>
          <div className={styles.processImage}>
            <Image
              src={materialPhoto}
              alt="鼠尾草绿织物的纤维与褶皱细节"
              fill
              sizes="(max-width: 767px) 100vw, 30vw"
            />
          </div>
          <figcaption>
            <h3>从材料的语言开始</h3>
            <p>带入面料图片与纹理参考，找到这一轮设计的起点。</p>
          </figcaption>
        </figure>
        <figure data-reveal style={{ transitionDelay: "40ms" }}>
          <div className={styles.processImage}>
            <Image
              src={sketchPhoto}
              alt="服装草图与鼠尾草绿立裁连衣裙"
              fill
              sizes="(max-width: 767px) 100vw, 25vw"
            />
          </div>
          <figcaption>
            <h3>把轮廓慢慢画清楚</h3>
            <p>从草图、结构与细节出发，和设计助手讨论下一步。</p>
          </figcaption>
        </figure>
        <span className={styles.processArrow}>
          <Arrow />
        </span>
        <figure data-reveal style={{ transitionDelay: "80ms" }}>
          <div className={styles.processImage}>
            <Image
              src={collectionPhoto}
              alt="象牙白、鼠尾草绿与炭灰色的三套系列造型"
              fill
              sizes="(max-width: 767px) 100vw, 40vw"
            />
          </div>
          <figcaption>
            <h3>让一个方向延展开来</h3>
            <p>比较色彩与搭配，把更好的方案留在同一个项目里。</p>
          </figcaption>
        </figure>
      </div>
      <p className={styles.exampleNote}>
        以上影像为 AI 设计示例，用于呈现创作方向。
      </p>
    </section>
  );
}

function InspirationSection() {
  const [active, setActive] = useState(0);
  const [inputMode, setInputMode] = useState<"pointer" | "keyboard">("pointer");
  const id = useId();
  const look = LOOKS[active] ?? LOOKS[0];
  const choose = (index: number, keyboard = false) => {
    setInputMode(keyboard ? "keyboard" : "pointer");
    setActive(index);
    if (keyboard) document.getElementById(id + "-tab-" + index)?.focus();
  };
  return (
    <section id="inspiration" tabIndex={-1} className={styles.inspiration}>
      <div className={styles.inspirationCopy} data-reveal>
        <h2>
          给同一份灵感，
          <br />
          更多种可能。
        </h2>
        <p className={styles.sectionLead}>
          有时，是一处纹理；有时，是一个轮廓。
          <br />
          让想法多走几步，再决定留下哪一版。
        </p>
        <div className={styles.lookTabs} role="tablist" aria-label="设计方向">
          {LOOKS.map((item, index) => (
            <button
              key={item.label}
              type="button"
              role="tab"
              id={id + "-tab-" + index}
              aria-controls={id + "-panel"}
              aria-selected={active === index}
              tabIndex={active === index ? 0 : -1}
              onClick={(event) => choose(index, event.detail === 0)}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                choose(
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? LOOKS.length - 1
                      : (active +
                          (event.key === "ArrowRight" ? 1 : -1) +
                          LOOKS.length) %
                        LOOKS.length,
                  true,
                );
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div
          className={styles.lookDetails}
          id={id + "-panel"}
          role="tabpanel"
          aria-labelledby={id + "-tab-" + active}
          aria-live="polite"
          tabIndex={0}
        >
          <span
            className={styles.colorSwatch}
            style={{ backgroundColor: look.color }}
            aria-hidden="true"
          />
          <h3>{look.title}</h3>
          <p>{look.description}</p>
          <dl>
            <div>
              <dt>材质印象</dt>
              <dd>{look.material}</dd>
            </div>
            <div>
              <dt>廓形方向</dt>
              <dd>{look.silhouette}</dd>
            </div>
          </dl>
        </div>
        <Link className={styles.textLink} href="/login?starter=collection">
          开始我的系列
          <Arrow />
        </Link>
      </div>
      <figure className={styles.lookFigure} data-reveal>
        <div className={styles.lookViewport}>
          <div
            className={styles.lookStrip}
            data-input-mode={inputMode}
            style={{
              transform: "translateX(" + (1 / 6 - look.focus) * 100 + "%)",
            }}
          >
            <Image
              src={collectionPhoto}
              alt={look.alt}
              fill
              sizes="(max-width: 900px) 300vw, 1800px"
            />
          </div>
        </div>
        <figcaption>
          <span>AI 设计示例</span>
          <span>{look.label}</span>
        </figcaption>
      </figure>
    </section>
  );
}

function ToolsSection() {
  return (
    <section id="tools" tabIndex={-1} className={styles.toolsSection}>
      <div className={styles.toolsInner}>
        <div className={styles.toolsIntro} data-reveal>
          <h2>
            灵感需要自由，
            <br />
            创作也需要秩序。
          </h2>
          <p>
            把参考、方案、迭代和交付，
            <br />
            留在同一条可追溯的设计路径里。
          </p>
          <Link className={styles.textLink} href="/login">
            进入设计工作室
            <Arrow />
          </Link>
        </div>
        <ul className={styles.featureList}>
          {FEATURES.map((feature) => (
            <li key={feature.icon} data-reveal>
              <FeatureIcon name={feature.icon} />
              <div>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function PublicLanding() {
  const root = useRef<HTMLElement>(null);
  const [heroReady, setHeroReady] = useState(false);
  useLandingReveals(root);
  return (
    <main id="top" ref={root} className={styles.page} data-public-landing>
      <LandingHeader />
      <section
        className={styles.hero}
        aria-labelledby="public-title"
        data-ready={heroReady}
      >
        <div className={styles.heroMedia}>
          <Image
            className={styles.heroImage}
            src={heroPhoto}
            alt="自然光工作室中身穿象牙白系带外套的模特"
            fill
            sizes="(max-width: 900px) 300vw, 100vw"
            preload
            placeholder="blur"
            onLoad={() => setHeroReady(true)}
          />
        </div>
        <div className={styles.heroWash} aria-hidden="true" />
        <div className={styles.heroCopy}>
          <h1 id="public-title" className={styles.heroTitle}>
            <span>让灵感，</span>
            <span>穿上形状。</span>
          </h1>
          <p>
            从面料、廓形与色彩出发，与 AI 一起，
            <br className={styles.leadBreak} />
            把创意做成可继续的服装系列。
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryAction} href="/login">
              开始创作
              <Arrow />
            </Link>
            <a className={styles.secondaryAction} href="#inspiration">
              探索设计灵感
            </a>
          </div>
        </div>
        <span className={styles.heroCaption}>AI 设计示例</span>
      </section>
      <ProcessSection />
      <InspirationSection />
      <ToolsSection />
      <section className={styles.closing} data-reveal>
        <div className={styles.closingIntro}>
          <h2>
            下一件设计，
            <br />
            从你开始。
          </h2>
          <p>
            带来一个想法，或一块喜欢的面料。
            <br />
            剩下的，边创作，边发现。
          </p>
          <Link className={styles.primaryAction} href="/login">
            开始我的设计
            <Arrow />
          </Link>
        </div>
        <div className={styles.starters}>
          {STARTERS.map((starter) => (
            <Link key={starter.href} href={starter.href}>
              <span>
                <strong>{starter.label}</strong>
                <small>{starter.description}</small>
              </span>
              <Arrow />
            </Link>
          ))}
        </div>
      </section>
      <footer className={styles.footer}>
        <BrandLockup size={34} />
        <span className={styles.copyright}>森织设计工作室</span>
        <a href="#top">
          回到顶部
          <Arrow />
        </a>
      </footer>
    </main>
  );
}
