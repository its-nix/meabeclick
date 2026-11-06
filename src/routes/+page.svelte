<script lang="ts">
  import Icon from '$lib/icons/Icon.svelte';
  import { lockScroll } from '$lib/scroll-lock.ts';
  import { onMount } from 'svelte';
  import Header from '$lib/components/Header.svelte';
  import Footer from '$lib/components/Footer.svelte';
  import AutoCarousel from '$lib/components/AutoCarousel.svelte';
  import { PLANS, formatPrice, RECOMMENDED_BADGE } from '$lib/plans.ts';
  import { initMarketing, track } from '$lib/marketing.ts';
  import { TUTOR_PHONE } from '$lib/contact.ts';
  import { TUTORS } from '$lib/tutors.ts';

  // Warm, low-friction opener for the WhatsApp CTAs beside both /booking
  // buttons — the same "just reach out" tone as the booking page's own
  // WhatsApp fallbacks (src/routes/booking/+page.svelte's wa-link hrefs).
  const WHATSAPP_TEXT = encodeURIComponent('היי, אשמח לשמוע על שיעורים פרטיים במתמטיקה');
  const WHATSAPP_HREF = `https://wa.me/${TUTOR_PHONE}?text=${WHATSAPP_TEXT}`;


  /* "שיעור יחיד שאורכו 45 דקות, שיעור כפול שאורכו שעה וחצי ושיעור משולש
     שאורכו שעתיים ורבע" — built from PLANS so the FAQ cannot drift from the
     cards directly above it, which is exactly what happened between this
     page and the booking flow. Hebrew joins the final item with a prefixed
     ו־, so the last element is handled separately rather than by a plain
     join(', '). */
  const DURATIONS_SENTENCE = PLANS
    .map(p => `שיעור ${p.name} שאורכו ${p.duration}`)
    .reduce((acc, part, i, all) =>
      i === 0 ? part : i === all.length - 1 ? `${acc} ו${part}` : `${acc}, ${part}`, '');

  /* Each picture shows what its card says, drawn at 4:3 for the box it is
     shown in (static/images/features/, Todoist 6hfrX4QGqF76c6pH). */
  const heroFeatures = [
    {
      kind: 'slides',
      image: '/images/features/personal-learning.svg',
      eyebrow: 'למידה אישית',
      title: 'לומדים בדיוק את מה שצריך עכשיו',
      copy: 'תוכן ברור שנבנה סביב הרמה, הקצב והמטרות של כל תלמיד.'
    },
    {
      kind: 'games',
      image: '/images/features/practice-game.svg',
      eyebrow: 'תרגול שמרגיש כמו משחק',
      title: 'מתרגלים, מקבלים משוב ומתקדמים',
      copy: 'משחקים קצרים שעוזרים להפוך הבנה לתרגול אמיתי.'
    },
    {
      kind: 'progress',
      image: '/images/features/parent-progress.svg',
      eyebrow: 'תמונה ברורה להורים',
      title: 'רואים התקדמות ויודעים מה הצעד הבא',
      copy: 'כל שיעור מתחבר לתכנית הלמידה ולמטרה הבאה של התלמיד.'
    }
  ];
  /* Maths only (Todoist 6hfrX4VFc3HWGF2q): the areas within it, not other
     subjects. */
  const mathAreas = [
    { icon: '🧱', label: 'יסודות וחיזוק פערים' },
    { icon: '📝', label: 'הכנה למבחנים' },
    { icon: '🔢', label: 'אלגברה' },
    { icon: '📐', label: 'גיאומטריה' },
    { icon: '📈', label: 'פונקציות' },
    { icon: '🎲', label: 'הסתברות' },
    { icon: '🎓', label: 'הכנה לבגרות' },
  ];
  /* «איך זה עובד?» (Todoist 6hfrX4W5mfXVmG5H): the path from a first
     booking to following progress, in the order a family meets it. */
  const HOW_STEPS = [
    { title: 'קובעים שיעור', copy: 'בוחרים מועד שנוח לכם כאן באתר, או כותבים לנו בוואטסאפ.' },
    { title: 'מבינים את הרמה והקושי', copy: 'בשיעור הראשון מזהים איפה התלמיד/ה עומד/ת, מה כבר ברור ומה מקשה.' },
    { title: 'בונים תכנית אישית', copy: 'תכנית במתמטיקה לפי החומר של הכיתה, ממוקדת במה שחשוב עכשיו: פער, מבחן או בגרות.' },
    { title: 'מתרגלים ומתקדמים', copy: 'בשיעור מסבירים עם מצגת ודוגמאות פתורות, ובין השיעורים מתרגלים בתרגילים ובמשחקים קצרים.' },
    { title: 'עוקבים אחרי ההתקדמות', copy: 'בפורטל רואים מה נלמד, מה השתפר ומה הצעד הבא.' },
  ];
  const DESCRIPTION = 'שיעורים פרטיים במתמטיקה מיסודי ועד בגרות: תכנית אישית, תרגול שמרגיש כמו משחק, ופורטל שבו ההורים רואים את ההתקדמות.';
  const testimonials = [
    { lines: ['תודה רבה על ההכוונה וההסבר המעולה.', 'הציונים שלי השתפרו מאוד בזכותך :)'], name: 'זיו כהן' },
    { lines: ['שיעור מעניין ומורה מעולה!', 'בזכותו הבנתי את כל החומר.'], name: 'מיכל ניאזוב' },
    { lines: ['השיעורים תמיד ברורים ומובנים,', 'תודה רבה!'], name: 'לימור ישראל' },
    { lines: ['ניקול מסבירה בסבלנות ובצורה מאוד ברורה.', 'ממליצה בחום לכל אחד!'], name: 'נועה לוי' },
    { lines: ['ליאור מוכשר להפליא,', 'הסביר לי בדיוק מה שהייתי צריך.'], name: 'עידו ברק' },
  ];

  let backToTopEl: HTMLButtonElement;
  let showStickyBooking = $state(false);
  let releaseTutorScroll: (() => void) | undefined;
  function openTutor(id: string) {
    const dialog = document.getElementById(`info-${id}`) as HTMLDialogElement | null;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    releaseTutorScroll = lockScroll();
  }
  function closeTutor(id: string) {
    (document.getElementById(`info-${id}`) as HTMLDialogElement | null)?.close();
  }
  function tutorClosed() { releaseTutorScroll?.(); releaseTutorScroll = undefined; }
  onMount(() => {
    initMarketing(new URL(location.href));
    track('landing_visit');
    const onScroll = () => {
      backToTopEl.classList.toggle('visible', window.scrollY > 320);
      showStickyBooking = (document.getElementById('hero')?.getBoundingClientRect().bottom ?? 0) <= 64;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); tutorClosed(); };
  });
</script>

<svelte:head>
  <title>מאה בקליק — שיעורים פרטיים במתמטיקה</title>
  <meta name="description" content={DESCRIPTION} />
  <meta property="og:title" content="מאה בקליק — שיעורים פרטיים במתמטיקה" />
  <meta property="og:description" content={DESCRIPTION} />
</svelte:head>

<button class="back-to-top" bind:this={backToTopEl} aria-label="חזרה לראש" onclick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>↑</button>

<Header />
<main id="public-content">

  <section id="hero">
    <div class="hero-badge">שיעורים פרטיים במתמטיקה · מיסודי ועד בגרות</div>

    <h1 class="hero-title">כל תלמיד יכול <span class="accent">להתקדם</span> במתמטיקה</h1>

    <div class="hero-subtitle-row">
      <span class="hero-sub-a">תכנית ברורה, תרגול מדויק וליווי אישי</span>
      <span class="hero-sub-b">רואים את ההתקדמות ויודעים מה הצעד הבא</span>
    </div>

    <div class="hero-primary-actions">
      <a class="hero-book" href="/booking" onclick={() => track('cta_click', { target: 'booking' })}>בדקו מועד לשיעור <span aria-hidden="true">←</span></a>
      <a class="hero-account" href="/portal">כבר לומדים איתנו? לדף האישי</a>
    </div>

    <!-- Tutors + surrounding feature cards -->
    <div class="tutors-showcase">

      <!-- Center: Tutor photos -->
      <div class="tutors-preview">

        {#each TUTORS as tutor (tutor.id)}
          <div class="tutor-card tutor-{tutor.id}" id="tutor-{tutor.id}">
            <button type="button" class="tutor-trigger" aria-label="הכירו את {tutor.name}" aria-haspopup="dialog" onclick={() => openTutor(String(tutor.id))}>
              <img src={tutor.photo} class="tutor-img" alt={tutor.alt} />
              <span class="tutor-name-badge">{tutor.name}</span>
            </button>
            <dialog class="tutor-info" id="info-{tutor.id}" aria-labelledby="tutor-heading-{tutor.id}" onclose={tutorClosed}>
              <button type="button" class="popup-close" aria-label="סגירת פרטי המורה" onclick={() => closeTutor(String(tutor.id))}>×</button>
              <h3 id="tutor-heading-{tutor.id}">{tutor.heading}</h3>
              <ul>
                {#each tutor.bio as line}
                  <li>{line}</li>
                {/each}
              </ul>
            </dialog>
          </div>
        {/each}

      </div>


      <!-- Hero feature carousel -->
      <div class="hero-feature-carousel">
        <div class="hero-feature-heading">
          <span>איך נראית הלמידה במאה בקליק?</span>
          <span class="hero-feature-count">3 דברים שעושים הבדל</span>
        </div>
        <AutoCarousel axis="x" speed={22} gap="16px" padding="8px 42px" label="איך נראית הלמידה במאה בקליק">
          {#each heroFeatures as feature (feature.kind)}
            <article class="hero-feature-card">
              <div class="hero-feature-art">
                <img src={feature.image} alt="" aria-hidden="true">
              </div>
              <div class="hero-feature-copy">
                <span class="hero-feature-eyebrow">{feature.eyebrow}</span>
                <h3>{feature.title}</h3>
                <p>{feature.copy}</p>
              </div>
            </article>
          {/each}
        </AutoCarousel>
      </div>

      <!-- Public sample lesson -->
        <article class="hero-dashboard-mini">
          <h2>מרגישים את הלמידה</h2>
          <p>הסברים בתנועה, ניסויים ותרגול שאפשר לחזור אליו בכל זמן.</p>
          <a href="/learn/parabolas">להתנסות בשיעור לדוגמה <span aria-hidden="true">←</span></a>
        </article>

    </div><!-- /tutors-showcase -->

  </section>

  <!-- ── FEATURES SHOWCASE ─────────────────────────────── -->
  <section id="features-showcase">
    <div class="container section-center">
      <div class="section-label">מה תקבלו</div>
      <h2 class="section-title">הלמידה שלנו נראית כך 👇</h2>

      <div class="showcase-grid">

        <!-- Slides -->
        <div class="showcase-card reveal reveal-delay-1">
          <div class="showcase-icon-wrap teal">📊</div>
          <h3>מצגות חכמות</h3>
          <p>חומר לימוד מותאם אישית — מצגות ברורות שנבנות בדיוק לפי הנושאים שהתלמיד צריך.</p>
          <div class="mini-slides">
            <div class="mini-slide"></div>
            <div class="mini-slide"></div>
            <div class="mini-slide"></div>
          </div>
        </div>

        <!-- Dashboard -->
        <div class="showcase-card reveal reveal-delay-2">
          <div class="showcase-icon-wrap coral">📈</div>
          <h3>לוח התקדמות</h3>
          <p>כל שיעור מתועד. הורים רואים בדיוק מה נלמד, מה השתפר, ומה הצעד הבא.</p>
          <div class="mini-dashboard">
            <div class="dash-bar-row">
              <span>אלגברה</span>
              <div class="dash-bar"><div class="dash-fill" style="width:82%"></div></div>
            </div>
            <div class="dash-bar-row">
              <span>גיאומטריה</span>
              <div class="dash-bar"><div class="dash-fill" style="width:65%"></div></div>
            </div>
            <div class="dash-bar-row">
              <span>הסתברות</span>
              <div class="dash-bar"><div class="dash-fill" style="width:90%"></div></div>
            </div>
          </div>
        </div>

        <!-- Games -->
        <div class="showcase-card reveal reveal-delay-3">
          <div class="showcase-icon-wrap green">🎮</div>
          <h3>משחקי לימוד</h3>
          <p>פלאשקארדים, קווינים ומשחקי ידע — כי תלמיד שנהנה לומד פי כמה יותר טוב.</p>
          <div class="mini-game-grid">
            <div class="mini-game-card">🃏 פלאשקארדים</div>
            <div class="mini-game-card">🎯 קוויז</div>
            <div class="mini-game-card">🏆 Kahoot</div>
            <div class="mini-game-card">🧩 Quizlet</div>
          </div>
        </div>

        <!-- Examples -->
        <div class="showcase-card reveal reveal-delay-1">
          <div class="showcase-icon-wrap purple">💡</div>
          <h3>דוגמאות ותרגילים</h3>
          <p>AI מזהה איפה התלמיד נתקע ומייצר תרגילים ממוקדים — בדיוק ברמה הנכונה.</p>
          <div class="mini-game-grid">
            <div class="mini-game-card">📝 דוגמה פתורה</div>
            <div class="mini-game-card">✏️ תרגיל מודרג</div>
            <div class="mini-game-card">🔁 חזרה חכמה</div>
            <div class="mini-game-card">🎓 מבחן ניסיון</div>
          </div>
        </div>

      </div>
    </div>
  </section>

  <!-- ── MATHS AREAS ───────────────────────────────────────── -->
  <section id="subjects">
    <div class="container section-center">
      <div class="section-label">תחומים</div>
      <h2 class="section-title">באילו תחומים במתמטיקה אנחנו עוזרים?</h2>
      <div class="subjects-carousel-outer">
        <AutoCarousel axis="x" speed={50} gap="1.4rem" padding="1rem 0" label="תחומים במתמטיקה">
          {#each mathAreas as sub (sub.label)}
            <div class="subj-card"><span class="subj-icon">{sub.icon}</span><span class="subj-label">{sub.label}</span></div>
          {/each}
        </AutoCarousel>
      </div>
    </div>
  </section>


  <!-- ── PRICING ────────────────────────────────────────── -->
  <section id="pricing">
    <div class="container section-center">
      <div class="section-label">תעריף</div>
      <h2 class="section-title">מחירים לשיעור</h2>
      <p class="section-sub">תשלום בסוף כל שיעור — ב-PayBox, בביט או במזומן</p>
      <div class="pricing-grid">

        {#each PLANS as plan, i (plan.minutes)}
          <div class="pricing-card reveal reveal-delay-{i + 1}" class:featured={plan.recommended}>
            {#if plan.recommended}<span class="pricing-badge">{RECOMMENDED_BADGE}</span>{/if}
            <div class="pricing-card-name">{plan.name}</div>
            <div class="pricing-card-price">{formatPrice(plan.shekels)}</div>
            <div class="pricing-card-duration">{plan.duration}</div>
            <p class="pricing-card-why">{plan.description}</p>
          </div>
        {/each}

      </div>
      <div class="pricing-cta-row">
        <a
          href="/booking"
          class="book-cta pricing-cta"
          onclick={() => track('cta_click', { target: 'booking' })}
        ><Icon name="booking" size={17} /> בדקו מועד לשיעור</a>
        <a
          href={WHATSAPP_HREF}
          target="_blank"
          rel="noopener"
          class="whatsapp-cta"
          onclick={() => track('cta_click', { target: 'whatsapp' })}
        ><Icon name="whatsapp" size={17} /> וואטסאפ</a>
      </div>
    </div>
  </section>

  <!-- ── TESTIMONIALS ───────────────────────────────────── -->
  <section id="testimonials">
    <div class="container section-center">
      <div class="section-label">המלצות</div>
      <h2 class="section-title">מה הלקוחות אומרים עלינו 💬</h2>
      <div class="testimonials-carousel-outer">
        <AutoCarousel axis="x" speed={50} reverse gap="1.4rem" padding="1rem 0" label="המלצות">
          {#each testimonials as t (t.name)}
            <div class="testimonial-card">
              <div class="testimonial-quote">"</div>
              <p>{t.lines[0]}<br />{t.lines[1]}</p>
              <div class="testimonial-name">— {t.name}</div>
            </div>
          {/each}
        </AutoCarousel>
      </div>
    </div>
  </section>


  <!-- ── STICKY BOOKING BUTTON ───────────────────────────── -->
  <section id="signup-button" class:shown={showStickyBooking} aria-hidden={!showStickyBooking}>
    <div class="sticky-cta-row">
      <a
        href="/booking"
        class="book-cta"
        onclick={() => track('cta_click', { target: 'booking' })}
      ><Icon name="booking" size={17} /> בדקו מועד לשיעור</a>
      <a
        href={WHATSAPP_HREF}
        target="_blank"
        rel="noopener"
        class="whatsapp-cta-icon"
        aria-label="וואטסאפ"
        onclick={() => track('cta_click', { target: 'whatsapp' })}
      ><Icon name="whatsapp" size={20} /></a>
    </div>
  </section>

  <!-- ── HOW IT WORKS ───────────────────────────────────── -->
  <section id="how-it-works">
    <div class="container section-center">
      <div class="section-label">התהליך</div>
      <h2 class="section-title">איך זה עובד?</h2>

      <ol class="how-steps reveal">
        {#each HOW_STEPS as step, i (step.title)}
          <li class="how-step">
            <span class="how-num" aria-hidden="true">{i + 1}</span>
            <h3>{step.title}</h3>
            <p>{step.copy}</p>
          </li>
        {/each}
      </ol>

      <a
        href="/booking"
        class="book-cta how-cta"
        onclick={() => track('cta_click', { target: 'booking' })}
      ><Icon name="booking" size={17} /> קובעים שיעור ראשון</a>

      <!-- What a parent still asks after the steps. Native <details>: it
           opens with the keyboard and a screen reader says whether it is
           open, which the click-only divs it replaces did not. -->
      <div class="faq-list" id="faqs">
        <h3 class="faq-title">עוד כמה פרטים</h3>

        <details class="faq-item">
          <summary>מה משך השיעור?<span class="faq-icon" aria-hidden="true">+</span></summary>
          <div class="faq-answer-inner">
            קיימת אפשרות להזמין שלושה סוגים של שיעורים: {DURATIONS_SENTENCE}.
          </div>
        </details>

        <details class="faq-item">
          <summary>איך מתבצע התשלום?<span class="faq-icon" aria-hidden="true">+</span></summary>
          <div class="faq-answer-inner">
            התשלום מתבצע בסוף כל שיעור, ב-PayBox (בקישור שנשלח אליכם), בביט או במזומן.
          </div>
        </details>

        <details class="faq-item">
          <summary>השיעורים פנים מול פנים או אונליין?<span class="faq-icon" aria-hidden="true">+</span></summary>
          <div class="faq-answer-inner">
            גם וגם, לפי מה שנוח לתלמיד/ה. שני הפורמטים יעילים ומותאמים אישית.
          </div>
        </details>
      </div>
    </div>
  </section>

</main>
<Footer />



<style>
.hero-primary-actions{display:flex;align-items:center;justify-content:center;gap:12px 24px;flex-wrap:wrap;margin:24px auto 40px}
.hero-book{display:inline-flex;align-items:center;justify-content:center;gap:20px;min-height:48px;padding:12px 24px;border-radius:12px;background:var(--action-fill);color:var(--action-text);font-size:1rem;font-weight:600}
.hero-account{display:inline-flex;align-items:center;min-height:44px;font-size:.9375rem;color:var(--accent-deep)}
.tutor-trigger{display:flex;flex-direction:column;align-items:center;gap:8px;border:0;background:transparent;color:var(--text-primary);font:inherit;cursor:pointer;border-radius:16px;padding:4px}
.tutor-info:not([open]){display:none!important}
dialog.tutor-info[open]{display:block;position:fixed;inset:0;width:min(420px,calc(100% - 32px));height:fit-content;max-height:calc(100dvh - 48px);margin:auto;padding:32px 24px 24px;transform:none;opacity:1;visibility:visible;pointer-events:auto;border:1px solid var(--border);border-radius:20px;background:var(--bg-card);color:var(--text-primary);text-align:start;overflow:auto;z-index:1700}
dialog.tutor-info::backdrop{background:rgb(0 0 0 / .32);backdrop-filter:blur(4px)}

/* ── Typography ────────────────────────────────────────────── */
h1, h2, h3, h4 {
  font-family: var(--font-ui);
  font-weight: 700;
  line-height: 1.2;
  color: var(--text-primary);
}

.section-label {
  display: inline-block;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent2-strong);
  background: var(--accent2-dim);
  border: 1.5px solid rgba(250, 130, 49, 0.35);
  padding: 0.28rem 0.9rem;
  border-radius: 20px;
  margin-bottom: 0.8rem;
}

.section-title {
  font-size: clamp(1.6rem, 3.5vw, 2.4rem);
  margin-bottom: 0.5rem;

}

.section-sub {
  color: var(--text-muted);
  font-size: 1rem;
  margin-bottom: 2.5rem;
  max-width: 520px;
  margin-left: auto;
  margin-right: auto;
}

/* ── Layout ────────────────────────────────────────────────── */
.container { max-width: 1080px; margin: 0 auto; padding: 0 1.5rem; }
.section-center { text-align: center; }

/* ── HERO ──────────────────────────────────────────────────── */
#hero {
  padding: 4.5rem 1.5rem 5.5rem;
  text-align: center;
  position: relative;
  overflow: hidden;
}

#hero::before {
  content: '';
  position: absolute;
  top: -10%;
  left: 50%;
  transform: translateX(-50%);
  width: 80vw;
  max-width: 700px;
  height: 500px;
  background: radial-gradient(ellipse at center,
    rgba(37, 99, 235, 0.12) 0%,
    rgba(59, 130, 246, 0.06) 45%,
    transparent 70%);
  pointer-events: none;
}

.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: var(--accent-dim);
  border: 1.5px solid var(--border-strong);
  color: var(--accent-deep);
  font-size: 0.84rem;
  font-weight: 700;
  padding: 0.32rem 1rem;
  border-radius: 24px;
  margin-bottom: 1.5rem;
  animation:none;
}

.hero-title {
  font-size: clamp(2.8rem, 6.5vw, 5.2rem);
  font-weight: 700;
  line-height: 1.08;
  margin-bottom: 0.55rem;

  animation:none;
}
.hero-title .accent { color: var(--accent2-strong); }

.hero-subtitle-row {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  margin-bottom: 2.6rem;
  animation:none;
}
.hero-sub-a {
  font-size: clamp(1.1rem, 2.5vw, 1.7rem);
  color: var(--text-muted);
  font-weight: 400;
}
.hero-sub-b {
  font-size: clamp(1.35rem, 3vw, 2.2rem);
  font-weight: 700;
  color: var(--text-primary);
}

/* ── TUTORS SHOWCASE LAYOUT ──────────────────────────────── */
.tutors-showcase {
  display: grid;
  grid-template-columns: 160px 1fr 160px;
  grid-template-rows: auto auto;
  align-items: start;
  column-gap: 1.5rem;
  row-gap: 1rem;
  max-width: 700px;
  margin: 0 auto;
  direction: ltr;
  animation:none;
}

/* Hero Feature Card — illustration style */
.hfc {
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: var(--r-lg);
  overflow: hidden;
  box-shadow: 0 4px 20px var(--shadow);
  direction: rtl;
  text-align: right;
  transition: transform 0.28s ease, box-shadow 0.28s ease;
}
.hfc:hover {
  transform: translateY(-5px);
  box-shadow: 0 16px 40px var(--shadow-md);
}

/* ── TUTORS ──────────────────────────────────────────────── */
.tutors-preview {
  display: flex;
  justify-content: center;
  align-items: flex-end;
  gap: 2rem;
  grid-column: 2;
  grid-row: 1;
  position: relative;
  width: 100%;
}

.hero-mini-carousel { grid-column: 1; grid-row: 1; }
.hero-games-mini    { grid-column: 3; grid-row: 1; }

/* Row 2, spanning all three columns. This placement is NOT optional: row 1 is
   fully claimed by the three rules above plus .tutors-preview, so without it
   the dashboard auto-flows into the next free cell — row 2, column 1 — and
   renders 160px wide at the bottom LEFT (left, not right, because
   .tutors-showcase sets `direction: ltr` inside an otherwise RTL page).
   The equivalent rule existed only inside the max-width: 680px block, so the
   layout was correct on mobile and broken at every desktop width. */
.hero-dashboard-mini { grid-column: 1 / 4; grid-row: 2; }

/* Desktop size for games carousel (matches slides carousel) */
.games-carousel-outer { width: 160px; }

.tutor-card {
  position: relative;
  cursor: pointer;
  flex-shrink: 0;
  padding-bottom: 28px;
}

.tutor-card::before { display: none; }

/* Glow behind image */
.tutor-card::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -58%);
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--accent-glow) 0%, transparent 70%);
  pointer-events: none;
}

.tutor-img {
  width: 54px;
  height: 54px;
  border-radius: 50%;
  object-fit: cover;
  border: 3px solid var(--bg-base);
  box-shadow: 0 4px 18px var(--shadow-md), 0 0 0 4px var(--accent-dim);
  position: relative;
  z-index: 1;
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}
.tutor-card:hover .tutor-img {
  transform: translateY(-4px);
  box-shadow: 0 12px 30px var(--shadow-md), 0 0 0 4px var(--accent-glow);
}

.tutor-name-badge {
  position: absolute;
  bottom: 2px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--action-fill);
  color: white;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.14rem 0.65rem;
  border-radius: 12px;
  white-space: nowrap;
  z-index: 3;
  letter-spacing: 0.02em;
  box-shadow: 0 3px 10px var(--shadow-accent);
}

.tutor-info h3{font-size:1.25rem;color:var(--text-primary);margin-bottom:16px;font-weight:600;padding-inline-end:32px}
.tutor-info ul{display:flex;flex-direction:column;gap:12px}
.tutor-info ul li{font-size:.9375rem;line-height:1.7;color:var(--text-muted-strong)}
.popup-close{position:absolute;inset-inline-end:12px;top:12px;display:grid;place-items:center;width:44px;height:44px;min-height:44px;border:0;border-radius:12px;background:var(--control-bg);color:var(--text-primary);font:inherit;font-size:1.5rem;cursor:pointer}

/* ── FEATURES SHOWCASE ────────────────────────────────────── */
#features-showcase {
  padding: 5rem 1.5rem;
  border-top: 1px solid var(--border);
  background: var(--bg-card);
}

.showcase-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 1.4rem;
  margin-top: 2.5rem;
}

.showcase-card {
  background: var(--bg-base);
  border: 1.5px solid var(--border);
  border-radius: var(--r-lg);
  padding: 1.8rem 1.6rem;
  text-align: center;
  box-shadow: 0 2px 10px var(--shadow);
  transition: all 0.28s ease;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.8rem;
}
.showcase-card:hover {
  border-color: var(--border-strong);
  transform: translateY(-5px);
  box-shadow: 0 12px 32px var(--shadow-md);
  background: var(--bg-card);
}

.showcase-icon-wrap {
  width: 62px;
  height: 62px;
  border-radius: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.9rem;
  margin-bottom: 0.3rem;
}
.showcase-icon-wrap.teal   { background: var(--accent-dim);  border: 1.5px solid var(--border-strong); }
.showcase-icon-wrap.coral  { background: var(--accent2-dim); border: 1.5px solid rgba(250,130,49,0.3); }
.showcase-icon-wrap.green  { background: rgba(34,197,94,0.08); border: 1.5px solid rgba(34,197,94,0.3); }
.showcase-icon-wrap.purple { background: rgba(139,92,246,0.08); border: 1.5px solid rgba(139,92,246,0.3); }

.showcase-card h3 {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary);
}
.showcase-card p {
  font-size: 0.88rem;
  color: var(--text-muted);
  line-height: 1.7;
}

/* Slideshow strip inside card */
.mini-slides {
  display: flex;
  gap: 5px;
  justify-content: center;
  margin-top: 0.5rem;
}
.mini-slide {
  width: 28px;
  height: 20px;
  border-radius: 5px;
  border: 1.5px solid var(--border);
}
.mini-slide:nth-child(1) { background: var(--accent-dim); }
.mini-slide:nth-child(2) { background: var(--accent2-dim); border-color: rgba(250,130,49,0.3); }
.mini-slide:nth-child(3) { background: rgba(139,92,246,0.08); border-color: rgba(139,92,246,0.25); }

/* Mini dashboard bars */
.mini-dashboard {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 100%;
  margin-top: 0.4rem;
}
.dash-bar-row { display: flex; align-items: center; gap: 6px; font-size: 0.72rem; color: var(--text-muted); }
.dash-bar { height: 7px; border-radius: 4px; background: var(--accent-dim); flex: 1; overflow: hidden; }
.dash-fill { height: 100%; border-radius: 4px; background: var(--action-fill); }

/* Mini game cards */
.mini-game-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
  margin-top: 0.4rem;
}
.mini-game-card {
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: 8px;
  padding: 0.35rem;
  font-size: 0.68rem;
  color: var(--text-muted);
  font-weight: 600;
  text-align: center;
  line-height: 1.4;
}

/* ── SUBJECTS ──────────────────────────────────────────────── */
#subjects {
  padding: 2.5rem 1.5rem;
  border-top: 1px solid var(--border);
}

/* ── Subjects Horizontal Carousel ──────────────────────── */
.subjects-carousel-outer {
  width: 100%;
  max-width: 100%;
  margin-top: 1.2rem;
}

.subj-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.8rem;
  width: 160px;
  height: 160px;
  background: var(--bg-card);
  border: 2px solid var(--accent);
  border-radius: 20px;
  box-shadow: 0 4px 16px var(--shadow);
  flex-shrink: 0;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  cursor: default;
}

.subj-card:hover {
  transform: translateY(-6px);
  box-shadow: 0 10px 28px var(--shadow-md);
}

.subj-icon { font-size: 3.2rem; line-height: 1; }

.subj-label {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text-primary);
  direction: rtl;
}

/* ── TESTIMONIALS ──────────────────────────────────────────── */
#testimonials {
  padding: 5rem 1.5rem;
  border-top: 1px solid var(--border);
}

.testimonials-carousel-outer {
  width: 100%;
  max-width: 100%;
  margin-top: 2rem;
}

.testimonial-card {
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: var(--r-lg);
  padding: 1.8rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  box-shadow: 0 2px 10px var(--shadow);
  transition: all 0.25s ease;
  width: 280px;
  flex-shrink: 0;
}
.testimonial-card:hover {
  border-color: var(--border-strong);
  transform: translateY(-4px);
  box-shadow: 0 10px 28px var(--shadow-md);
}

.testimonial-quote {
  font-size: 2.5rem;
  line-height: 1;
  color: var(--accent2);
  opacity: 0.5;
}
.testimonial-card p {
  color: var(--text-muted);
  font-size: 1rem;
  line-height: 1.75;
  flex: 1;
}
.testimonial-card .testimonial-name {
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--accent);
}

/* ── PRICING ───────────────────────────────────────────────── */
#pricing {
  padding: 1.5rem 1.5rem;
  border-top: 1px solid var(--border);
  background: var(--bg-surface);
}

.pricing-grid {
  display: flex;
  flex-direction: row;
  justify-content: center;
  gap: 1.25rem;
  max-width: 780px;
  margin: 2rem auto 0;
}

.pricing-card {
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: var(--r-xl);
  padding: 1.2rem 1.6rem;
  text-align: center;
  box-shadow: 0 2px 12px var(--shadow);
  transition: all 0.25s ease;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.pricing-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 14px 36px var(--shadow-md);
}

.pricing-card.featured {
  background: var(--pricing-featured-bg);
  border: 2px solid var(--pricing-featured-border);
  box-shadow: 0 4px 24px var(--accent2-glow), 0 2px 12px var(--shadow);
  position: relative;
}
.pricing-card.featured:hover {
  transform: translateY(-6px);
  box-shadow: 0 16px 44px var(--accent2-glow), 0 8px 24px var(--shadow);
}
.pricing-badge {
  position: absolute;
  top: -14px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--accent2);
  color: var(--btn-text);
  font-size: 0.72rem;
  font-weight: 700;
  padding: 0.22rem 0.9rem;
  border-radius: 20px;
  white-space: nowrap;
  letter-spacing: 0.02em;
  box-shadow: 0 3px 10px var(--accent2-glow);
}

.pricing-card-name {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 0.5rem;
}
.pricing-card-price {
  font-size: 3.2rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1;
  margin-bottom: 0.3rem;

}
.pricing-card-duration {
  font-size: 0.83rem;
  color: var(--text-muted);
  margin-bottom: 0;
}
.pricing-card-why {
  font-size: 0.85rem;
  line-height: 1.45;
  color: var(--text-muted);
  margin: 0.55rem 0 0;
  max-width: 16rem;
}
.pricing-card.featured .pricing-card-why {
  color: var(--text-primary);
  font-weight: 600;
}

/* ── HOW IT WORKS ──────────────────────────────────────────── */
#how-it-works {
  padding: 5rem 1.5rem 3rem;
  border-top: 1px solid var(--border);
  background: var(--bg-surface);
}

/* A numbered path: one column on a phone, five across on a wide screen.
   The numbers are the list's own order, drawn, so they are aria-hidden. */
.how-steps {
  list-style: none;
  padding: 0;
  margin: 2rem auto 0;
  max-width: 1100px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.9rem;
  text-align: right;
}
.how-step {
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: 0.9rem;
  align-items: start;
  /* Cards in a row share a height; the spare space goes below the text,
     so every title sits on the same line. */
  align-content: start;
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: var(--r-md);
  padding: 1rem 1.2rem;
  box-shadow: 0 2px 8px var(--shadow);
}
.how-num {
  grid-row: span 2;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--action-fill);
  color: #fff;
  font-weight: 700;
  font-size: 1.05rem;
  display: flex;
  align-items: center;
  justify-content: center;
}
.how-step h3 { margin: 0.1rem 0 0.25rem; font-size: 1.02rem; font-weight: 700; color: var(--text-primary); }
.how-step p { margin: 0; color: var(--text-muted); font-size: 0.92rem; line-height: 1.7; }
@media (min-width: 992px) {
  .how-steps { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .how-step { grid-template-columns: 1fr; text-align: center; padding: 1.3rem 1rem; }
  .how-num { grid-row: auto; margin: 0 auto 0.7rem; }
}
.how-cta { margin-top: 2rem; }

/* ── THE SHORT FAQ, under the steps ────────────────────────── */
.faq-list {
  max-width: 720px;
  margin: 3rem auto 0;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  text-align: right;
}
.faq-title { margin: 0 0 0.3rem; font-size: 1.1rem; font-weight: 700; color: var(--text-primary); }

.faq-item {
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: var(--r-md);
  overflow: hidden;
  box-shadow: 0 2px 8px var(--shadow);
  transition: border-color 0.2s;
}
.faq-item[open] { border-color: var(--border-strong); }

.faq-item summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-height: 44px;
  padding: 1.1rem 1.4rem;
  cursor: pointer;
  font-weight: 600;
  font-size: 1rem;
  color: var(--text-primary);
  list-style: none;
}
.faq-item summary::-webkit-details-marker { display: none; }
.faq-item summary:focus-visible { outline: 3px solid var(--accent); outline-offset: -3px; }

.faq-icon {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--accent-dim);
  border: 1.5px solid var(--border-strong);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  font-weight: 700;
  line-height: 1;
  transition: transform 0.3s, background 0.2s;
}
.faq-item[open] .faq-icon {
  background: var(--action-fill);
  border-color: var(--accent);
  color: white;
  transform: rotate(45deg);
}

.faq-answer-inner {
  padding: 0 1.4rem 1.2rem;
  color: var(--text-muted);
  font-size: 0.95rem;
  line-height: 1.85;
}

/* ── PRICING CTA ───────────────────────────────────────────── */
.pricing-cta-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 0.9rem;
  margin-top: 1.8rem;
}

.pricing-cta {
  width: auto !important;
  padding: 0.85rem 2.4rem !important;
}

/* ── STICKY BOOKING BUTTON ─────────────────────────────────── */
#signup-button {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 999;
  display: flex;
  justify-content: center;
  padding: 0.75rem 1rem;
  background: linear-gradient(0deg, var(--bg-base) 65%, transparent 100%);
}

/* Two buttons where the sticky bar used to hold one. This bar is
   position:fixed and must stay ONE line at every width — a labelled
   second button here (like .whatsapp-cta in the pricing section) wrapped
   onto its own line on phones and made the fixed bar ~120px tall,
   permanently covering content. So only the primary label lives here;
   the WhatsApp action is the icon-only .whatsapp-cta-icon below, sized to
   never need to wrap (flex-wrap: nowrap, not wrap — verified in the
   browser check at 320/375/390/430/1280 that the row's own height stays
   under one line and nothing scrolls horizontally). .book-cta's own
   width:100%/max-width:380px (below) is what let it fill and centre
   itself as the sole child; inside this row it is sized to its content
   instead, same as the pricing-row's .pricing-cta variant. */
.sticky-cta-row {
  display: flex;
  flex-wrap: nowrap;
  justify-content: center;
  align-items: center;
  gap: 0.6rem;
  max-width: 100%;
}
.sticky-cta-row .book-cta {
  width: auto;
  max-width: none;
  flex: 0 1 auto;
  min-width: 0;
}

.book-cta {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  background: var(--accent2);
  color: var(--btn-text);
  font-family: var(--font-ui);
  font-size: 1.05rem;
  font-weight: 700;
  padding: 0.82rem 2.5rem;
  border-radius: 40px;
  text-decoration: none;
  box-shadow: 0 4px 20px var(--accent2-glow), 0 2px 8px var(--shadow);
  transition: transform 0.22s ease, box-shadow 0.22s ease, opacity 0.22s ease;
  max-width: 380px;
  width: 100%;
  justify-content: center;
  letter-spacing: 0.02em;
}
.book-cta:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 28px var(--accent2-glow), 0 4px 12px var(--shadow);
  opacity: 0.92;
  color: white;
}

/* ── WHATSAPP CTA (secondary) ─────────────────────────────────
   Same shape and rhythm as .book-cta — same radius, padding, weight —
   but an outline instead of a fill, so it reads as the secondary action
   beside the primary booking CTA. WhatsApp green with WhatsApp's mark, so
   it reads as WhatsApp at a glance: it used to be the peach's dark
   orange, which read as red (Todoist 6hfrX4MVcfMjPP6q). --whatsapp-strong
   is the green tokens.css names for TEXT/BORDER (--whatsapp is fills-only,
   see its comment there). */
.whatsapp-cta {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  background: var(--bg-card);
  color: var(--whatsapp-strong);
  font-family: var(--font-ui);
  font-size: 1.05rem;
  font-weight: 700;
  padding: 0.82rem 2.2rem;
  border-radius: 40px;
  border: 1.5px solid var(--whatsapp-strong);
  text-decoration: none;
  transition: transform 0.22s ease, background 0.22s ease, opacity 0.22s ease;
  letter-spacing: 0.02em;
}
.whatsapp-cta:hover {
  transform: translateY(-3px);
  background: var(--whatsapp-dim);
}
.whatsapp-cta:active { transform: translateY(-1px); background: var(--whatsapp-dim); }
.whatsapp-cta:focus-visible { outline: 3px solid var(--whatsapp-strong); outline-offset: 3px; }

/* ── WHATSAPP CTA, icon-only (sticky bar) ───────────────────────
   Same secondary styling as .whatsapp-cta (green outline, --whatsapp-strong
   — see that rule's comment), but round and label-free so the fixed
   bottom bar it lives in never grows past one line. 46px with a 44px
   floor keeps it at least the standard minimum touch target. The label
   moves to aria-label since there is no visible text beside the icon. */
.whatsapp-cta-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  min-width: 44px;
  min-height: 44px;
  flex: none;
  border-radius: 50%;
  background: var(--bg-card);
  color: var(--whatsapp-strong);
  border: 1.5px solid var(--whatsapp-strong);
  text-decoration: none;
  transition: transform 0.22s ease, background 0.22s ease, opacity 0.22s ease;
}
.whatsapp-cta-icon:hover {
  transform: translateY(-3px);
  background: var(--whatsapp-dim);
}
.whatsapp-cta-icon:active { transform: translateY(-1px); background: var(--whatsapp-dim); }
.whatsapp-cta-icon:focus-visible { outline: 3px solid var(--whatsapp-strong); outline-offset: 3px; }


/* ── BACK TO TOP ───────────────────────────────────────────── */
.back-to-top {
  position: fixed;
  bottom: 80px;
  left: 20px;
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  color: var(--accent);
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: all 0.3s ease;
  z-index: 998;
  box-shadow: 0 3px 12px var(--shadow-md);
}
.back-to-top:global(.visible) { opacity: 1; pointer-events: all; }
.back-to-top:hover {
  background: var(--action-fill);
  color: white;
  border-color: var(--accent);
  transform: translateY(-2px);
}

/* ── SCROLL REVEAL ─────────────────────────────────────────── */
.reveal { opacity:1; transform:none; }
.reveal:global(.visible) { opacity: 1; transform: translateY(0); }

/* ── ANIMATIONS ────────────────────────────────────────────── */
@keyframes fade-up {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes spin-slow {
  from { transform: translate(-50%, -58%) rotate(0deg); }
  to   { transform: translate(-50%, -58%) rotate(360deg); }
}

@keyframes float-bob {
  0%, 100% { transform: translateY(0); }
  50%       { transform: translateY(-5px); }
}
@keyframes float-bob-middle {
  0%, 100% { transform: translateY(-50%); }
  50%       { transform: translateY(calc(-50% - 5px)); }
}

/* ── Dashboard Static Preview ───────────────────────────────── */
.dash-preview {
  width: 100%;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--border);
  box-shadow: 0 4px 16px var(--shadow);
  display: block;
  background: #fff;
  direction: rtl;
}
.dash-preview::-webkit-scrollbar { display: none; }

@keyframes bounce-down {
  0%, 100% { transform: translateY(0);   opacity: 1; }
  50%       { transform: translateY(4px); opacity: 0.5; }
}
@keyframes dp-ripple {
  0%   { transform: scale(1);   opacity: 0.6; }
  100% { transform: scale(2.8); opacity: 0; }
}

/* ── Dashboard Mini Mockup ────────────────────────────────── */
.dashboard-mockup-mini {
  width: 100%;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 8px 30px rgba(30, 41, 59, 0.15);
  border: 1px solid var(--border);
}

.mockup-chrome {
  background: #EFF6FF;
  border-bottom: 1px solid var(--border);
  padding: 6px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.mockup-url {
  flex: 1;
  text-align: center;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 0.65rem;
  color: var(--text-muted);
  font-family: var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dashboard-mockup-mini {
  width: 330px;
}

/* ── Side panels (carousel left, games right) ─────────────── */
/* Both panels are 160px wide (grid column) × 210px tall — identical size */
.hero-mini-carousel,
.hero-games-mini {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

/* ── Games Carousel ──────────────────────────────────────── */
.games-carousel-outer {
  width: 160px;
  height: 210px;
  overflow: hidden;
  border-radius: 12px;
  position: relative;
  box-shadow: 0 8px 30px rgba(30, 41, 59, 0.15);
  border: 1px solid var(--border);
}

/* ── Slides Carousel ──────────────────────────────────────── */
/* Same dimensions as games collage: 160×210px */
.slides-carousel-outer {
  width: 160px;
  height: 210px;
  overflow: hidden;
  border-radius: 12px;
  position: relative;
}

/* ── Slide Cards ──────────────────────────────────────────── */
.sp-card {
  flex-shrink: 0;
  width: 100%;
  height: 90px;
  border-radius: 8px;
  border: 2px solid var(--border);
  box-shadow: 0 4px 18px var(--shadow-md);
  position: relative;
  overflow: hidden;
}

/* Card backgrounds */
.sp-light      { background: #FFFFFF; }
.sp-dark-photo { background: #0E1628; }
.sp-navy       { background: #1E293B; }
.sp-teal-slide { background: #2563EB; }
.sp-warm       { background: #FFF7ED; }

/* Image fills the card */
.sp-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* SVG fills the card */
.sp-svg,
.sp-svg-full {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

/* Grid lines layer (integrals card) */
.sp-grid-lines {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0.35;
}

/* ── Text Overlay ─────────────────────────────────────────── */
.sp-text-overlay {
  position: absolute;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sp-text-top-right {
  top: 8px;
  right: 8px;
  align-items: flex-end;
  text-align: right;
}

/* Titles */
.sp-title-dark  { font-size: 0.62rem; font-weight: 700; color: #1E293B; line-height: 1.2; font-family: var(--font-ui); }
.sp-title-light { font-size: 0.62rem; font-weight: 700; color: #FFFFFF; line-height: 1.2; font-family: var(--font-ui); }
.sp-title-xl    { font-size: 0.65rem; font-weight: 700; color: #FFFFFF; line-height: 1.2; font-family: var(--font-ui); }

/* Subtitles — hidden in mini carousel */
.sp-sub-dark,
.sp-sub-light { display: none; }

/* Badges — hidden in mini carousel */
.sp-badge,
.sp-badge-teal,
.sp-badge-bottom { display: none; }


@media (max-width: 768px) {
  .hero-title   { font-size: 2.4rem; }
  .hero-sub-b   { font-size: 1.35rem; }
  .tutors-preview { gap: 1.5rem; }
  .pricing-grid { flex-direction: column; align-items: center; max-width: 320px; margin-left: auto; margin-right: auto; }
  .pricing-card { width: 100%; }

  .showcase-grid { grid-template-columns: 1fr 1fr; }
  .container { padding: 0 1rem; }
}

@media (max-width: 480px) {
  #hero { padding: 3rem 0.5rem 4.5rem; }
  .showcase-grid { grid-template-columns: 1fr; }
  .hfc { min-width: 160px; }
}

/* ── RESPONSIVE 680px — must stay at end to override base styles ── */
@media (max-width: 680px) {
  /* Grid: slides|photos|games in row 1, dashboard centered in row 2 */
  .tutors-showcase {
    display: grid;
    grid-template-columns: 28% 1fr 28%;
    grid-template-rows: auto auto;
    column-gap: 2px;
    row-gap: 0.8rem;
    padding: 0 4px;
    box-sizing: border-box;
    direction: ltr;
    max-width: 100%;
    width: 100%;
  }

  /* Photos — center column, row 1 */
  .tutors-preview {
    grid-column: 2;
    grid-row: 1;
    justify-content: center;
    align-items: flex-end;
    gap: 1.2rem;
    min-width: 0;
  }

  /* Slides — left column, row 1 */
  .hero-mini-carousel {
    grid-column: 1;
    grid-row: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    min-width: 0;
  }

  /* Dashboard — spans all columns, row 2, centered */
  .hero-dashboard-mini {
    grid-column: 1 / 4;
    grid-row: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
  }

  /* Games — right column, row 1 */
  .hero-games-mini {
    grid-column: 3;
    grid-row: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    min-width: 0;
  }

  /* Slides & games carousels fill their column */
  .slides-carousel-outer,
  .games-carousel-outer {
    width: 100%;
    height: 105px;
  }

  /* Dashboard static preview */
  .dash-preview {
    width: 100%;
  }

  /* Labels below each panel */


  .showcase-side {
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
  }
  .hfc { flex: 1; min-width: 200px; max-width: 280px; }
}

/* ── Very small phones (≤ 390px) ───────────────────────────── */
@media (max-width: 390px) {
  #hero { padding: 2rem 0.5rem 3.5rem; }
  .hero-title { font-size: 2rem; }
  .hero-sub-a { font-size: 0.95rem; }
  .hero-sub-b { font-size: 1.1rem; }
  .hero-badge { font-size: 0.75rem; padding: 0.25rem 0.7rem; }

  .tutors-showcase {
    grid-template-columns: 26% 1fr 26%;
    column-gap: 1px;
    padding: 0 2px;
  }

  .tutor-img { width: 44px; height: 44px; }
  .tutors-preview { gap: 0.8rem; }

  .slides-carousel-outer,
  .games-carousel-outer { height: 90px; }


  .pricing-grid { flex-direction: column; align-items: center; }
  .pricing-card { width: 100%; max-width: 280px; }

  .book-cta { font-size: 0.95rem; padding: 0.7rem 1.5rem; }
  .whatsapp-cta { font-size: 0.95rem; padding: 0.7rem 1.3rem; }
}

/* ── Redesigned hero feature carousel ─────────────────────── */
.hero-feature-carousel {
  grid-column: 1 / 4;
  grid-row: 3;
  width: min(100%, 680px);
  margin: 0 auto;
  direction: rtl;
  text-align: right;
}
.hero-feature-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin: 1.4rem 0 0.25rem;
  padding: 0 0.35rem;
  color: var(--text-primary);
  font-size: 1rem;
  font-weight: 700;
}
.hero-feature-count {
  color: var(--text-muted);
  font-size: 0.76rem;
  font-weight: 600;
}
/* Height follows the tallest card: a fixed height cut the text of any
   card that needed one more line. */
.hero-feature-carousel :global(.ac) {
  height: auto;
  direction: ltr;
}
.hero-feature-carousel :global(.ac-viewport) {
  border: 1px solid rgba(37, 99, 235, 0.16);
  border-radius: 20px;
  background: linear-gradient(135deg, rgba(219, 234, 254, 0.46), rgba(255,255,255,0.88));
  box-shadow: 0 18px 44px rgba(30, 58, 138, 0.12);
}
.hero-feature-carousel :global(.ac-track) { align-items: stretch; }
.hero-feature-card {
  flex: 0 0 min(88%, 560px);
  min-width: 0;
  display: grid;
  grid-template-columns: 42% 1fr;
  direction: rtl;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 15px;
  background: #fff;
  box-shadow: 0 7px 24px rgba(15, 23, 42, 0.08);
}
.hero-feature-art {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 190px;
  padding: 10px;
  /* The pictures' own background, so the space `contain` leaves around
     one is the picture's, not a band of another colour. */
  background: #EFF6FF;
}
/* Whole, never cropped: `cover` showed a third of each picture on a phone. */
.hero-feature-art img { width: 100%; height: 100%; max-height: 230px; object-fit: contain; display: block; }
.hero-feature-copy {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 1.3rem 1.45rem;
  text-align: right;
}
.hero-feature-eyebrow { color: #2563EB; font-size: 0.75rem; font-weight: 700; }
.hero-feature-copy h3 { margin: 0.5rem 0 0.35rem; color: #0F172A; font-size: clamp(1.15rem, 2.2vw, 1.55rem); line-height: 1.25; }
.hero-feature-copy p { margin: 0; color: #475569; font-size: 0.94rem; line-height: 1.65; }

@media (max-width: 680px) {
  .hero-feature-carousel { grid-column: 1 / 4; grid-row: 3; width: 100%; }
  .hero-feature-heading { margin-top: 1rem; font-size: 0.9rem; }
  .hero-feature-count { font-size: 0.68rem; }
  /* Picture above the text, at full width: a side column left it a third
     of a narrow, tall box. */
  .hero-feature-card { flex-basis: 84%; grid-template-columns: 1fr; }
  .hero-feature-art { min-height: 0; aspect-ratio: 16 / 9; padding: 8px 8px 0; }
  .hero-feature-copy { padding: 1rem; }
  .hero-feature-copy h3 { font-size: 1.05rem; }
  .hero-feature-copy p { font-size: 0.82rem; line-height: 1.5; }
}

@media (prefers-reduced-motion: reduce) {
  .hero-feature-carousel :global(.ac-track) { scroll-behavior: auto; }
}

#hero{padding:56px 24px 64px}
#hero::before{display:none}
.hero-badge{background:transparent;border:0;border-radius:0;padding:0;color:var(--text-muted);font-weight:500;margin-bottom:16px}
.hero-title{font-size:3.5rem;line-height:1.2;max-width:780px;margin-inline:auto;margin-bottom:16px}
.hero-title .accent{color:var(--text-primary)}
.hero-sub-a{font-size:1.125rem}.hero-sub-b{font-size:1.125rem;font-weight:500;color:var(--text-muted)}
.hero-subtitle-row{margin-bottom:0}
.tutor-name-badge{background:transparent;color:var(--text-primary);box-shadow:none;font-weight:600}
.tutor-img{box-shadow:none;border:3px solid var(--bg-card)}
.section-label{background:transparent;border:0;color:var(--text-muted);padding:0;border-radius:0;font-weight:500;letter-spacing:0}
.section-title{font-size:2rem}
.hero-feature-count{display:none}
@media(max-width:600px){#hero{padding:36px 20px 40px}.hero-title{font-size:2.25rem}.hero-primary-actions{flex-direction:column;gap:8px;margin:24px 0 32px}.hero-book{width:100%}.tutors-preview{gap:20px}}

.tutors-showcase{display:flex;flex-direction:column;align-items:stretch;gap:24px;max-width:700px;direction:rtl}
.tutors-preview{display:flex;justify-content:center;gap:32px;width:100%;margin:0}
.tutor-card{width:auto;height:auto;flex:none;animation:none}
.tutor-trigger .tutor-img{width:72px;height:72px;border:3px solid var(--bg-card);box-shadow:none}
.tutor-name-badge{position:static;transform:none;font-size:.9375rem;line-height:1.4;padding:0;letter-spacing:0}
.hero-dashboard-mini{width:100%;max-width:none;border:1px solid var(--border);border-radius:18px;padding:24px;background:var(--bg-card);box-shadow:none;text-align:start;direction:rtl;margin:0}
.hero-dashboard-mini h2{font-size:1.25rem;font-weight:600;margin-bottom:8px}
.hero-dashboard-mini p{color:var(--text-muted);font-size:.9375rem;line-height:1.7}
.hero-dashboard-mini a{display:inline-flex;gap:16px;align-items:center;min-height:44px;font-size:.9375rem;margin-top:12px;font-weight:500}
#signup-button{background:var(--nav-bg);border-top:1px solid var(--border);backdrop-filter:blur(16px);padding-bottom:max(12px,env(safe-area-inset-bottom))}
.book-cta{background:var(--action-fill);color:var(--action-text);box-shadow:none;border-radius:12px}
.book-cta:hover{color:var(--action-text);transform:none;box-shadow:none}
.pricing-card.featured{background:var(--bg-card);border-color:var(--border-strong);box-shadow:none}
.pricing-card.featured:hover{box-shadow:none}

#signup-button{visibility:hidden;transform:translateY(100%);transition:transform var(--motion-normal),visibility var(--motion-normal)}
#signup-button.shown{visibility:visible;transform:none}
</style>
