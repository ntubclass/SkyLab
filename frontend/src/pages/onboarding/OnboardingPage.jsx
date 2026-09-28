/**
 * OnboardingPage — 首次登入引導精靈。
 *
 * 登入後 `user.onboarding_completed` 為 false 時，App 只渲染這一頁（不進 DashboardLayout）：
 *   語言 → 外觀 → 兩步驟驗證 → 完成。
 * 語言與外觀選了就立即套用並存在瀏覽器（i18n localStorage／themePreferenceStore），
 * 兩步驟驗證沿用帳號設定的 TotpEnrollment；「開始使用」與右上「略過」都會呼叫
 * /users/me/onboarding/complete，之後登入不再出現。
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import MIcon from "../../components/MIcon";
import RotatingWelcome from "../../components/RotatingWelcome/RotatingWelcome";
import { AppearanceQuickSettings } from "../personal/account/AppearanceSettings";
import SegmentedControl from "../../components/SegmentedControl/SegmentedControl";
import Stepper from "../../components/Stepper/Stepper";
import TotpEnrollment from "../../components/TotpEnrollment/TotpEnrollment";
import { useAuth } from "../../contexts/AuthContext";
import { THEME_DEFAULTS, useTheme } from "../../contexts/ThemeContext";
import { useToast } from "../../hooks/useToast";
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, setLanguage } from "../../i18n";
import { AccountService } from "../../services/account";
import shell from "../setup/SetupPage.module.scss";
import styles from "./OnboardingPage.module.scss";

const STEP_APPEARANCE = 0;
const STEP_TOTP = 1;
const STEP_FINISH = 2;
const STEP_KEYS = ["appearance", "totp", "finish"];

/* 語言用原生名稱顯示，不翻譯 */
const LANG_OPTIONS = [
  { key: "zh-TW", label: "繁體中文" },
  { key: "en", label: "English" },
  { key: "ja", label: "日本語" },
];

const MODE_OPTIONS = [
  { key: "light", icon: "light_mode", labelKey: "OnboardingPage.modeLight" },
  { key: "dark", icon: "dark_mode", labelKey: "OnboardingPage.modeDark" },
  { key: "system", icon: "monitor", labelKey: "OnboardingPage.modeSystem" },
];

function useCurrentLanguage() {
  const { i18n } = useTranslation();
  return SUPPORTED_LANGUAGES.includes(i18n.language) ? i18n.language : DEFAULT_LANGUAGE;
}

/* ─── 外框（與初始化精靈同一套樣式） ─────────────────────── */

function Notice({ icon = "info", tone = "info", children }) {
  return (
    <div className={`${shell.notice} ${shell[`notice_${tone}`]}`}>
      <MIcon name={icon} size={20} />
      <div>{children}</div>
    </div>
  );
}

/* ─── 歡迎：選語言 ───────────────────────────────────────── */

function LanguageWelcome({ onContinue }) {
  const { t } = useTranslation("login");
  const current = useCurrentLanguage();
  return (
    <div className={shell.welcome}>
      <RotatingWelcome className={shell.welcomeTitle} i18nKey="OnboardingPage.welcomeTitle" />
      <p className={styles.welcomeHint}>{t("OnboardingPage.welcomeHint")}</p>
      {/* 互斥選項一律用共用 SegmentedControl；語言名稱用原生寫法，按鈕帶 lang 讓讀屏用對的語音 */}
      <SegmentedControl
        className={shell.langSwitch}
        ariaLabel={t("OnboardingPage.languageLabel")}
        value={current}
        onChange={setLanguage}
        options={LANG_OPTIONS.map((option) => ({ value: option.key, label: option.label, buttonProps: { lang: option.key } }))}
      />
      <button type="button" className={shell.btnPrimary} onClick={onContinue}>
        {t("OnboardingPage.continue")}
        <MIcon name="arrow_forward" size={18} />
      </button>
    </div>
  );
}

/* ─── 步驟 1：外觀 ───────────────────────────────────────── */

function AppearanceStep({ onBack, onNext }) {
  const { t } = useTranslation("login");

  return (
    <section className={shell.section}>
      <h2 className={shell.sectionTitle}>{t("OnboardingPage.appearanceTitle")}</h2>

      {/* 選法以系統內為主：沿用帳號設定的配色主題與介面（風格、明暗模式）元件；
         主色、背景色、背景花色、上傳圖片等細調先不放，留到帳號設定再調 */}
      <AppearanceQuickSettings />

      <div className={shell.actions}>
        <button type="button" className={shell.btnSecondary} onClick={onBack}>
          <MIcon name="arrow_back" size={18} />
          {t("OnboardingPage.back")}
        </button>
        <button type="button" className={shell.btnPrimary} onClick={onNext}>
          {t("OnboardingPage.next")}
          <MIcon name="arrow_forward" size={18} />
        </button>
      </div>
    </section>
  );
}

/* ─── 步驟 2：兩步驟驗證 ─────────────────────────────────── */

function TotpStep({ onBack, onNext }) {
  const { t } = useTranslation("login");
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const [enrolling, setEnrolling] = useState(false);
  const enabled = Boolean(user?.totp_enabled);

  function handleConfirmed() {
    updateUser({ totp_enabled: true, totp_setup_required: false });
    toast.success(t("OnboardingPage.totpEnabledToast"));
    setEnrolling(false);
    onNext();
  }

  return (
    <section className={shell.section}>
      <h2 className={shell.sectionTitle}>{t("OnboardingPage.totpTitle")}</h2>

      {enabled ? (
        <Notice icon="verified_user" tone="success">{t("OnboardingPage.totpEnabledNotice")}</Notice>
      ) : (
        <Notice icon="security">{t("OnboardingPage.totpDesc")}</Notice>
      )}

      {enrolling && !enabled ? (
        <div className={styles.enrollBody}>
          <TotpEnrollment
            onConfirmed={handleConfirmed}
            onCancel={() => setEnrolling(false)}
            confirmLabel={t("OnboardingPage.totpConfirm")}
          />
        </div>
      ) : (
        <div className={shell.actions}>
          <button type="button" className={shell.btnSecondary} onClick={onBack}>
            <MIcon name="arrow_back" size={18} />
            {t("OnboardingPage.back")}
          </button>
          <div className={shell.actionGroup}>
            {enabled ? (
              <button type="button" className={shell.btnPrimary} onClick={onNext}>
                {t("OnboardingPage.next")}
                <MIcon name="arrow_forward" size={18} />
              </button>
            ) : (
              <>
                <button type="button" className={shell.btnSecondary} onClick={onNext}>
                  {t("OnboardingPage.skipStep")}
                </button>
                <button type="button" className={shell.btnPrimary} onClick={() => setEnrolling(true)}>
                  <MIcon name="qr_code_2" size={18} />
                  {t("OnboardingPage.totpStart")}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/* ─── 步驟 3：完成 ───────────────────────────────────────── */

function FinishStep({ onBack, onComplete, completing }) {
  const { t } = useTranslation("login");
  const { user } = useAuth();
  const { mode, primaryColor } = useTheme();
  const language = useCurrentLanguage();

  const languageLabel = LANG_OPTIONS.find((o) => o.key === language)?.label ?? language;
  const modeLabel = t(MODE_OPTIONS.find((o) => o.key === mode)?.labelKey ?? "OnboardingPage.modeSystem");
  const colorLabel = primaryColor.toLowerCase() === THEME_DEFAULTS.primaryColor
    ? t("OnboardingPage.defaultColor")
    : primaryColor;

  return (
    <section className={shell.section}>
      <h2 className={shell.sectionTitle}>{t("OnboardingPage.finishTitle")}</h2>
      <p className={shell.sectionDesc}>{t("OnboardingPage.finishDesc")}</p>

      <dl className={shell.summary}>
        <div>
          <dt><MIcon name="language" size={18} />{t("OnboardingPage.summaryLanguage")}</dt>
          <dd>{languageLabel}</dd>
        </div>
        <div>
          <dt><MIcon name="palette" size={18} />{t("OnboardingPage.summaryAppearance")}</dt>
          <dd>
            {modeLabel} · <span className={styles.colorDot} style={{ background: primaryColor }} aria-hidden="true" />{colorLabel}
          </dd>
        </div>
        <div>
          <dt><MIcon name="security" size={18} />{t("OnboardingPage.summaryTotp")}</dt>
          <dd className={user?.totp_enabled ? undefined : shell.muted}>
            {user?.totp_enabled ? t("OnboardingPage.totpOn") : t("OnboardingPage.totpOff")}
          </dd>
        </div>
      </dl>

      <div className={shell.actions}>
        <button type="button" className={shell.btnSecondary} onClick={onBack} disabled={completing}>
          <MIcon name="arrow_back" size={18} />
          {t("OnboardingPage.back")}
        </button>
        <button type="button" className={shell.btnPrimary} onClick={onComplete} disabled={completing}>
          {completing ? t("OnboardingPage.finishing") : t("OnboardingPage.start")}
          {!completing && <MIcon name="rocket_launch" size={18} />}
        </button>
      </div>
    </section>
  );
}

/* ─── 頁面 ─────────────────────────────────────────────── */

export default function OnboardingPage() {
  const { t } = useTranslation("login");
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const [started, setStarted] = useState(false);
  const [step, setStep] = useState(STEP_APPEARANCE);
  const [completing, setCompleting] = useState(false);

  const stepLabels = useMemo(() => [
    t("OnboardingPage.stepAppearance"),
    t("OnboardingPage.stepTotp"),
    t("OnboardingPage.stepFinish"),
  ], [t]);

  /* 「開始使用」與「略過」都走這裡：後端標記完成，App 看到旗標就切回正常路由 */
  async function complete() {
    if (completing) return;
    setCompleting(true);
    try {
      const me = await AccountService.completeOnboarding();
      updateUser({ onboarding_completed: Boolean(me?.onboarding_completed ?? true) });
    } catch (err) {
      toast.error(err?.message ?? t("OnboardingPage.completeFailed"));
      setCompleting(false);
    }
  }

  return (
    <div className={shell.page}>
      <div className={shell.glow} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      {/* 歡迎畫面用窄卡，進入步驟後用寬卡（同初始化精靈） */}
      <div className={`${shell.card} ${styles.cardWithSkip} ${started ? shell.cardWide : ""}`}>
        <button
          type="button"
          className={styles.skipBtn}
          onClick={complete}
          disabled={completing}
        >
          {t("OnboardingPage.skip")}
        </button>

        {started ? (
          <>
            <header className={shell.header}>
              <h1 className={shell.title}>{t("OnboardingPage.title")}</h1>
            </header>
            {/* 共用步驟列：外觀走過就算設好；兩步驟驗證要真的綁定才打勾；只能點回走過的步驟 */}
            <div className={shell.wizardTop}>
              <Stepper
                ariaLabel={t("OnboardingPage.stepsAriaLabel")}
                steps={STEP_KEYS.map((key, index) => ({
                  key,
                  label: stepLabels[index],
                  done: key === "appearance" ? step > STEP_APPEARANCE : key === "totp" ? Boolean(user?.totp_enabled) : false,
                  disabled: index > step,
                }))}
                activeKey={STEP_KEYS[step]}
                onSelect={(key) => setStep(STEP_KEYS.indexOf(key))}
              />
            </div>
            {step === STEP_APPEARANCE && (
              <AppearanceStep
                onBack={() => setStarted(false)}
                onNext={() => setStep(STEP_TOTP)}
              />
            )}
            {step === STEP_TOTP && (
              <TotpStep
                onBack={() => setStep(STEP_APPEARANCE)}
                onNext={() => setStep(STEP_FINISH)}
              />
            )}
            {step === STEP_FINISH && (
              <FinishStep
                onBack={() => setStep(STEP_TOTP)}
                onComplete={complete}
                completing={completing}
              />
            )}
          </>
        ) : (
          <LanguageWelcome onContinue={() => setStarted(true)} />
        )}
      </div>
    </div>
  );
}
