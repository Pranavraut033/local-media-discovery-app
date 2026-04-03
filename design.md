# Design System Specification: High-End Editorial Discovery

## 1. Overview & Creative North Star: "The Digital Curator"
This design system is built to transcend the "utility app" aesthetic, moving instead toward the feeling of a high-end, bespoke digital broadsheet. The Creative North Star is **The Digital Curator**: an experience that feels quiet, authoritative, and intentionally paced.

To achieve this, we break from the "templated" look by embracing **Intentional Asymmetry**. Rather than a rigid, centered grid, we use generous white space (the `2` spacing token, equivalent to `16` and `24` tokens) to create a sense of luxury. Elements should feel like they are "resting" on fine paper rather than being locked into a digital box. We prioritize content through a high-contrast typographic scale, where the elegance of a serif heading commands attention against a minimalist, functional UI.

---

## 2. Colors: Tonal Depth & The "No-Line" Rule
The palette is a study in sophisticated neutrals, adapted for a **dark color mode**. It avoids pure blacks and harsh whites in favor of a "soft-lit" environment.

### The "No-Line" Rule
**Strict Mandate:** Designers are prohibited from using 1px solid borders for sectioning or containment.
* **How to define boundaries:** Use background color shifts. A `surface-container-low` card should sit on a `surface` background.
* **The Transition:** Use the subtle shift between `surface-container` and `surface-bright` to create "zones" of content without ever drawing a line.

### Surface Hierarchy & Nesting
Treat the UI as physical layers of stacked, semi-opaque material.
* **Base:** `background`
* **Secondary Content Zones:** `surface-container-low`
* **Elevated Components (Cards):** `surface-container-lowest`
* **Nesting:** When placing an element inside a container, use the next tier in the hierarchy to define importance. An input field inside a `surface-container` should use `surface-container-highest` to feel recessed and "carved out."

### Signature Textures
While we avoid "flashy" gradients, use **Linear Tonal Fades** to add soul.
* **CTA Backgrounds:** Transition from `primary` to `primary-dim` at a 45-degree angle. This provides a "weighted" feel that flat color lacks.

---

## 3. Typography: Editorial Authority
The interplay between **Newsreader** (Headings) and **Manrope** (UI/Body) creates a tension between tradition and modernity.

* **Display & Headlines (Newsreader):** Use `display-lg` (3.5rem) for hero moments. The serif's elegance suggests a curated, human touch.
* **Body & Labels (Manrope):** Use `body-lg` (1rem) for long-form discovery text. Manrope’s geometric clarity ensures high readability even at `body-sm` (0.75rem).
* **Hierarchy Note:** Always maintain at least two scale jumps between a headline and its sub-copy to ensure an authoritative "Editorial" contrast.

---

## 4. Elevation & Depth: Tonal Layering
Traditional drop shadows are largely replaced by tonal shifts.

* **The Layering Principle:** Depth is achieved by stacking. Place a `surface-container-lowest` card on a `surface-container-low` section. This creates a "soft lift" that feels natural and premium.
* **Ambient Shadows:** If an element must float (e.g., a bottom navigation bar), use a Tinted Ambient Shadow:
* **Blur:** 24px - 40px
* **Opacity:** 4% - 6%
* **Color:** Use `on-surface` rather than pure black to mimic real-world lighting.
* **The "Ghost Border" Fallback:** If accessibility requires a border, use the `outline-variant` token at **15% opacity**. High-contrast borders are strictly forbidden.
* **Glassmorphism:** For floating overlays, use `surface-container-lowest` at 80% opacity with a `backdrop-filter: blur(12px)`.

---

## 5. Components
All components follow the **Roundedness Scale**: `DEFAULT` (0.5rem/8px) for small elements and `lg` (1rem/16px) for larger cards. The `roundedness` token is set to `2` (moderate).

* **Buttons:**
* *Primary:* `primary` background, `on-primary` text. No border.
* *Secondary:* `secondary-container` background, `on-secondary-container` text.
* *Tertiary:* Ghost style. No background, `on-surface` text, `label-md` weight.
* **Cards (Media Discovery):**
* Use `surface-container-low` for the card body.
* **Forbid Dividers:** Use vertical white space (the `spacing` token, set to `2`) to separate headers from metadata.
* **Input Fields:**
* Base: `surface-container-highest`.
* Focus State: A "Ghost Border" of `primary` at 20% opacity.
* Typography: Always use `body-md` for user input.
* **Editorial Chips:**
* Used for local categories (e.g., "Brooklyn," "Arts").
* Style: `secondary-fixed` background with `on-secondary-fixed` text. Roundedness: `full`.
* **The Discovery Feed:**
* Utilize "The Stack": A vertical list where items are separated by a `spacing-5` gap (which maps to the general `spacing` token of `2` for a normal density) and a subtle shift from `surface` to `surface-container-low` on hover/active states.

---

## 6. Do’s and Don’ts

### Do
* **Do** use the general `spacing` token (set to `2`) for top-level section margins to create "Editorial Breathing Room."
* **Do** mix font weights. Use `title-lg` (Manrope) for functional labels and `headline-sm` (Newsreader) for content titles in the same view.
* **Do** use `on-surface-variant` for secondary metadata to reduce visual noise.

### Don’t
* **Don’t** use 1px dividers to separate list items. Use white space (`spacing` token `2`) or alternating surface tones.
* **Don’t** use "pure" colors. Every color in the system is slightly desaturated to maintain a sophisticated, neutral mood.
* **Don’t** crowd the edges. Elements should never be closer than `3.5` (1.2rem) to the screen edge.
* **Don’t** use standard "Blue" for links. Use `primary` with an underline or `tertiary` for a subtle chromatic shift.