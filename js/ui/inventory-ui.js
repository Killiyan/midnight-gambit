// Shared player and NPC inventory interactions. Keep timing and layout behavior identical.
export function mgBindInventoryUI(html) {
    // Inventory Search
    {
      const $root = html instanceof jQuery ? html : $(html);
      const $tab  = $root.find(".tab-inventory");

      if (!$tab.length) return;

      const STAGGER_STEP_MS = 80;   // delay between each card's enter
      const STAGGER_COUNT   = 3;    // how many cards get staggered
      const DEBOUNCE_MS     = 220;
      const LEAVE_MS        = 500;  // must match your CSS transition time

      const debounce = (fn, wait = DEBOUNCE_MS) => {
        let t;
        return (...args) => {
          clearTimeout(t);
          t = setTimeout(() => fn(...args), wait);
        };
      };

      // Decide if a given inventory card matches the query
      const cardMatches = (el, q) => {
        const norm = (s) => String(s ?? "").toLowerCase();

        // Title text (your cards style plain h3, so include it as fallback)
        const nameEl =
          el.querySelector(".name") ||
          el.querySelector(".clickable-item") ||
          el.querySelector("h3");
        const name = norm(nameEl?.textContent || "");

        // Tags text (support multiple possible structures)
        const tagsEl =
          el.querySelector(".item-tags") ||
          el.querySelector(".tags") ||
          el.querySelector("[data-tags]");
        const tags = norm(tagsEl?.textContent || "");

        // Notes/description fallbacks (your SCSS uses .desc)
        const notesEl =
          el.querySelector(".notes") ||
          el.querySelector(".desc") ||
          el.querySelector(".item-description");
        const notes = norm(notesEl?.textContent || "");

        return !q || name.includes(q) || tags.includes(q) || notes.includes(q);
      };

      // Animate a card entering (visible)
      const enterCard = (el, idx = 0) => {
        el.classList.remove("is-entering", "is-leaving", "pre-enter");

        // If it's currently visible, briefly hide to restart animation
        if (!el.classList.contains("is-hidden")) {
          el.classList.add("is-hidden");
          // force reflow so the browser sees the class change
          // eslint-disable-next-line no-unused-expressions
          el.offsetHeight;
        }

        el.classList.remove("is-hidden");
        el.classList.add("pre-enter");
        // another reflow to lock in starting state
        // eslint-disable-next-line no-unused-expressions
        el.offsetHeight;

        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
        const slot   = Math.min(idx, STAGGER_COUNT - 1);
        const delay  = reduce ? 0 : slot * STAGGER_STEP_MS;
        el.style.transitionDelay = `${delay}ms`;

        requestAnimationFrame(() => {
          el.classList.add("is-entering");
          const onEnd = (e) => {
            if (e && e.target !== el) return;
            el.classList.remove("is-entering", "pre-enter");
            el.style.transitionDelay = "";
            el.removeEventListener("transitionend", onEnd);
          };
          el.addEventListener("transitionend", onEnd, { once: true });
        });
      };

      // Animate a card leaving (fading out + sliding down)
      const leaveCard = (el) => {
        el.classList.remove("is-entering", "pre-enter");
        el.style.transitionDelay = "";
        if (el.classList.contains("is-hidden")) return;
        el.classList.add("is-leaving");
      };

      // Animate an inventory bucket title entering (visible)
      const enterTitle = (el) => {
        el.classList.remove("is-entering", "is-leaving", "pre-enter");
        el.style.transitionDelay = "";

        // lock in start state
        el.classList.add("pre-enter");
        // eslint-disable-next-line no-unused-expressions
        el.offsetHeight;

        requestAnimationFrame(() => {
          el.classList.add("is-entering");

          const onEnd = (e) => {
            if (e && e.target !== el) return;
            el.classList.remove("is-entering", "pre-enter");
            el.removeEventListener("transitionend", onEnd);
          };

          el.addEventListener("transitionend", onEnd, { once: true });
        });
      };

      // Animate an inventory bucket title leaving (fade/slide out)
      const leaveTitle = (el) => {
        el.classList.remove("is-entering", "pre-enter");
        el.style.transitionDelay = "";
        el.classList.add("is-leaving");
      };

      // Show / hide the "no results" message
      const showEmpty = (show) => {
        const empty =
          $tab.find(".inventory-search-empty")[0] ||
          $tab.find(".inventory-empty")[0];
        if (!empty) return;
        empty.style.display = show ? "block" : "none";
      };

      // Temp bucket state while searching (so collapsed buckets don't hide matches)
      let mgBucketPreSearchState = null;

      let mgInvSearchToken = 0;
      let mgInvSearchTimer = null;

      // --- Search: unified grid across buckets ---
      let mgInvSearchGrid = null;        // the temporary grid we render matches into
      let mgInvCardHomes = null;         // Map(cardEl -> { parent, next })
      let mgInvBucketEls = null;         // cached bucket wrapper nodes (optional)

      const ensureSearchGrid = () => {
        const tabEl = $tab?.[0];
        if (!tabEl) return null;

        // IMPORTANT: your SCSS is nested under .inventory-tab
        const invRoot = tabEl.querySelector(".inventory-tab") || tabEl;

        // Reuse if it exists + connected
        if (mgInvSearchGrid && mgInvSearchGrid.isConnected) return mgInvSearchGrid;

        // Reuse if it already exists in DOM
        mgInvSearchGrid = invRoot.querySelector(".inventory-search-grid");
        if (mgInvSearchGrid) return mgInvSearchGrid;

        // Create it with the SAME class your styling expects
        mgInvSearchGrid = document.createElement("div");
        mgInvSearchGrid.className = "inventory-grid inventory-search-grid";
        mgInvSearchGrid.style.display = "none"; // only show while searching

        // Anchor: first bucket title (wherever it actually lives)
        const firstTitle = invRoot.querySelector(".inventory-bucket-title");

        if (firstTitle?.parentNode) {
          // Insert into the SAME parent as the title so insertBefore is valid
          firstTitle.parentNode.insertBefore(mgInvSearchGrid, firstTitle);
        } else {
          // Fallback: put it at top of inventory section if possible
          const section = invRoot.querySelector(".inventory-section") || invRoot;
          section.prepend(mgInvSearchGrid);
        }

        return mgInvSearchGrid;
      };

      // Snapshot original home positions once (so we can restore after search)
      const snapshotCardHomes = (cards) => {
        if (mgInvCardHomes) return;
        mgInvCardHomes = new Map();
        for (const card of cards) {
          mgInvCardHomes.set(card, { parent: card.parentNode, next: card.nextSibling });
        }
      };

      // Hide/show bucket *parts* during search so they stop affecting layout.
      const setBucketsVisible = (visible) => {
        const tabEl = $tab[0];
        if (!tabEl) return;

        const bodies = Array.from(tabEl.querySelectorAll(".inventory-bucket-body"));
        const titles = Array.from(tabEl.querySelectorAll(".inventory-bucket-title"));

        // Cache original inline display so restore is accurate
        const stashDisplay = (el) => {
          if (!el) return;
          if (el.dataset.mgOrigDisplay === undefined) {
            el.dataset.mgOrigDisplay = el.style.display ?? "";
          }
        };

        for (const b of bodies) {
          stashDisplay(b);
          b.style.display = visible ? (b.dataset.mgOrigDisplay || "") : "none";
        }

        // Titles are also managed elsewhere (animation), but this makes restore resilient
        for (const t of titles) {
          stashDisplay(t);
          t.style.display = visible ? (t.dataset.mgOrigDisplay || "") : "none";
        }
      };

      // Move only matching cards into the unified grid (keeps original DOM order)
      const renderMatchesIntoSearchGrid = (cards, matchSet) => {
        const grid = ensureSearchGrid();
        if (!grid) return;

        grid.innerHTML = "";
        grid.style.display = "flex";

        // Append matches in the original DOM order
        for (const card of cards) {
          if (matchSet.has(card)) grid.appendChild(card);
        }
      };

      // Restore all cards back to their original parent + position
      const restoreCardsToHomes = () => {
        const grid = ensureSearchGrid();
        if (grid) {
          grid.style.display = "none";
          grid.innerHTML = "";
        }

        if (!mgInvCardHomes) return;

        for (const [card, home] of mgInvCardHomes.entries()) {
          const parent = home?.parent;
          if (!parent) continue;

          const next = home.next;
          if (next && next.parentNode === parent) parent.insertBefore(card, next);
          else parent.appendChild(card);
        }
      };

      const runSearchNow = () => {
        const input = $tab.find(".item-search")[0];
        const q = (input?.value || "").toLowerCase().trim();
        const searching = q.length > 0;

        // If searching, temporarily force bucket bodies open so matches can appear
        const bucketTitles = $tab.find(".inventory-bucket-title").toArray();
        const bucketBodies = $tab.find(".inventory-bucket-body").toArray();

        if (searching && !mgBucketPreSearchState) {
          mgBucketPreSearchState = bucketBodies.map((body) => {
            const title = body.previousElementSibling?.classList?.contains("inventory-bucket-title")
              ? body.previousElementSibling
              : null;

            return {
              body,
              hidden: !!body.hidden,
              maxHeight: body.style.maxHeight,
              title,
              titleCollapsed: !!title?.classList?.contains("is-collapsed"),
              titleDisplay: title?.style?.display ?? ""
            };
          });
        }

        if (searching) {
          for (const body of bucketBodies) {
            body.hidden = false;
            body.style.maxHeight = ""; // let it size naturally for search
          }
          for (const t of bucketTitles) {
            t.classList.remove("is-collapsed");
            t.classList.add("active");
          }
        }

        const titles = $tab.find(".inventory-bucket-title").toArray();
        const cards  = $tab.find(".inventory-card, .inventory-item").toArray();

        // Cancel any in-flight finalize from a previous search
        mgInvSearchToken += 1;
        const token = mgInvSearchToken;

        if (mgInvSearchTimer) {
          clearTimeout(mgInvSearchTimer);
          mgInvSearchTimer = null;
        }

        // Hard reset transition classes so the next search ALWAYS animates
        for (const el of cards) {
          el.classList.remove("is-entering", "pre-enter", "is-leaving");
          el.style.transitionDelay = "";
          // if it was hidden from the previous query, keep it hidden for now — we’ll decide after LEAVE_MS
        }
        for (const t of titles) {
          t.classList.remove("is-entering", "pre-enter", "is-leaving");
          t.style.transitionDelay = "";
        }

        // Build match set
        const matchSet = new Set(cards.filter((el) => cardMatches(el, q)));

        // Snapshot card homes once so we can restore after search
        snapshotCardHomes(cards);

        // Start leave animation for ALL cards (even ones that will remain)
        for (const el of cards) leaveCard(el);

        // Start leave animation for titles ONLY when searching
        if (searching) {
          for (const t of titles) leaveTitle(t);
        }


        // After leave animation finishes, finalize DOM layout + re-enter matches
        mgInvSearchTimer = setTimeout(() => {
          if (token !== mgInvSearchToken) return; // stale finalize, ignore

          // Toggle titles out of layout *after* fade so it feels seamless
          if (searching) {
            for (const t of titles) {
              t.style.display = "none";
              t.classList.remove("is-leaving");
            }
          } else {
            for (const t of titles) {
              t.style.display = "";
              t.classList.remove("is-leaving");
              enterTitle(t);
            }
          }

          if (searching) {
            // Remove buckets from layout and render matches into unified grid
            setBucketsVisible(false);
            renderMatchesIntoSearchGrid(cards, matchSet);
          } else {
            // Restore bucket layout and return cards to their original homes
            setBucketsVisible(true);
            restoreCardsToHomes();
          }

          let hits = 0;
          let enterIndex = 0;

          for (const el of cards) {
            const isMatch = searching ? matchSet.has(el) : true;

            // finalize leave
            el.classList.remove("is-leaving");

            if (isMatch) {
              hits++;
              // Make sure it’s not hidden before we animate in
              el.classList.remove("is-hidden");

              // Force a reflow so re-adding enter classes always triggers (prevents “flicker” on 2nd search)
              // eslint-disable-next-line no-unused-expressions
              el.offsetHeight;

              enterCard(el, enterIndex++);
            } else {
              el.classList.add("is-hidden");
            }
          }

          showEmpty(hits === 0 && searching);

          // Bucket titles + restoring collapsed state after clearing search
          if (searching) {
            for (const t of bucketTitles) t.style.display = "none";
          } else {
            for (const t of bucketTitles) t.style.display = "";

            if (mgBucketPreSearchState) {
              for (const st of mgBucketPreSearchState) {
                if (!st?.body) continue;

                st.body.hidden = !!st.hidden;
                if (st.body.hidden) st.body.style.maxHeight = "0px";
                else st.body.style.maxHeight = st.maxHeight || "";

                if (st.title) {
                  st.title.classList.toggle("is-collapsed", !!st.titleCollapsed);
                  st.title.classList.toggle("active", !st.titleCollapsed);
                  st.title.style.display = st.titleDisplay || "";
                }
              }
              mgBucketPreSearchState = null;
            }
          }

        }, LEAVE_MS);
      };


      const runSearch = debounce(runSearchNow, DEBOUNCE_MS);

      // ----- Event wiring: Enter key + Search + Reset -----

      // Enter in the search input
      $root
        .off("keydown.mgInvSearchEnter")
        .on("keydown.mgInvSearchEnter", ".tab-inventory .item-search", (ev) => {
          if (ev.key !== "Enter") return;
          ev.preventDefault();
          ev.stopPropagation();
          ev.stopImmediatePropagation();
          runSearch();
        });


      // Click the Search button
      $root
        .off("click.mgInvSearchBtn")
        .on("click.mgInvSearchBtn", ".tab-inventory .item-search-btn", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          ev.stopImmediatePropagation();
          runSearch();
        });

      // Click the Reset button
      $root
        .off("click.mgInvSearchReset")
        .on("click.mgInvSearchReset", ".tab-inventory .item-search-reset", (ev) => {
          ev.preventDefault();

          const input = $tab.find(".item-search")[0];
          if (input) input.value = "";

          // Run the same logic as “empty search”
          runSearchNow();
        });

        // ------------------------------------------------------------
        // Inventory bucket collapse / expand (smooth + persisted)
        // Insert this block ABOVE:  // "See All / See Less" for inventory cards
        // ------------------------------------------------------------
        {
          const $root = html instanceof jQuery ? html : $(html);
          const $tabs = $root.find(".tab-inventory, .tab-gambits, .tab-moves");
          if (!$tabs.length) return;

          const BUCKET_MS = 500; // keep in sync with your other inventory transitions

          // Persist bucket state per actor (store ONLY collapsed buckets)
          const BUCKET_FLAG_SCOPE = "midnight-gambit";
          const BUCKET_FLAG_KEY   = "inventoryBucketCollapsed";

          const getBucketKey = (titleEl) => {
            if (!titleEl) return null;

            // 1) Prefer an explicit stable key if present
            const explicit = titleEl.dataset?.bucketKey
              || titleEl.getAttribute?.("data-bucket-key")
              || titleEl.dataset?.bucket
              || titleEl.getAttribute?.("data-bucket");
            if (explicit) {
              const k = String(explicit).trim().toLowerCase();
              titleEl.dataset.bucketKey = k; // lock it in for future calls
              return k;
            }

            // 2) Derive a stable key from text, but strip dynamic junk like "(3)"
            const rawText = String(titleEl.textContent || "");
            const cleaned = rawText
              .replace(/\(\s*\d+\s*\)/g, "")   // remove counts like "(3)"
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase();

            if (!cleaned) return null;

            // Lock the derived key onto the element so it stays consistent during this session
            titleEl.dataset.bucketKey = cleaned;
            return cleaned;
          };


          const readState = () => {
            try { return this.actor?.getFlag(BUCKET_FLAG_SCOPE, BUCKET_FLAG_KEY) || {}; }
            catch (_e) { return {}; }
          };

          const writeState = async (state) => {
            try {
              // Write flags without forcing a sheet rerender (keeps your animation intact)
              const path = `flags.${BUCKET_FLAG_SCOPE}.${BUCKET_FLAG_KEY}`;
              await this.actor.update({ [path]: state }, { render: false });
            } catch (_e) {}
          };

          // Turn: [Title][Cards...][Next Title] into [Title][Body{Cards...}][Next Title]
          const ensureBucketBodies = () => {
            const tabRoots = $tabs.toArray();

            for (const root of tabRoots) {
              const titles = Array.from(root.querySelectorAll(".inventory-bucket-title"));
              for (const title of titles) {
                let next = title.nextElementSibling;

                // already normalized
                if (next && next.classList?.contains("inventory-bucket-body")) continue;

                const body = document.createElement("div");

                body.classList.add("inventory-bucket-body");
                body.style.width = "100%";
                body.style.overflow = "hidden";

                // Animate the outer clip without resizing the card layout inside it.
                const grid = document.createElement("div");
                grid.classList.add("inventory-grid");
                body.appendChild(grid);
                title.insertAdjacentElement("afterend", body);

                // Move everything until the next title into the body
                while (next && !next.classList.contains("inventory-bucket-title")) {
                  const move = next;
                  next = next.nextElementSibling;
                  grid.appendChild(move);
                }
              }
            }
          };

          const setChevronState = (titleEl, collapsed) => {
            titleEl.classList.toggle("is-collapsed", collapsed);
            titleEl.classList.toggle("active", !collapsed);
            const icon = titleEl.querySelector(".inventory-bucket-toggle i");
            if (icon) icon.classList.toggle("rotated", !collapsed); // rotated = expanded
            titleEl.querySelector(".inventory-bucket-toggle")?.setAttribute("aria-expanded", String(!collapsed));
          };

          const bucketHasItems = (body) =>
            body?.classList.contains("mg-move-accordion-body") ||
            !!body?.querySelector?.(".inventory-card, .inventory-item, .gambit-card, .mg-deck-slot-card, .mg-hand-order-card");

          // Smooth max-height animation + stable end state (hidden=true when collapsed)
          const animateBucket = (body, expand) => {
            if (!body) return Promise.resolve();

            return new Promise((resolve) => {
              // prevent double clicks during animation
              if (body.dataset.animating === "1") return resolve();
              body.dataset.animating = "1";
              body.classList.toggle("is-bucket-animating", true);

              const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
              const ms = reduce ? 0 : BUCKET_MS;

              body.style.overflow = "hidden";
              body.style.transition = `max-height ${ms}ms ease`;

              const finish = () => {
                body.style.transition = "";
                body.style.overflow = "";
                body.dataset.animating = "0";
                body.classList.toggle("is-bucket-animating", false);
                resolve();
              };

              if (expand) {
                body.hidden = false;

                body.style.maxHeight = "0px";
                // force reflow
                // eslint-disable-next-line no-unused-expressions
                body.offsetHeight;

                body.style.maxHeight = `${body.scrollHeight}px`;

                const onEnd = (e) => {
                  if (e && e.target !== body) return;
                  body.removeEventListener("transitionend", onEnd);

                  // let it size naturally after opening
                  body.style.maxHeight = "";
                  finish();
                };

                if (ms === 0) return onEnd();
                body.addEventListener("transitionend", onEnd, { once: true });
                setTimeout(onEnd, ms + 120);
                return;
              }

              // collapse
              body.hidden = false; // ensure measurable
              body.style.maxHeight = `${Math.ceil(body.getBoundingClientRect().height)}px`;
              // force reflow
              // eslint-disable-next-line no-unused-expressions
              body.offsetHeight;

              body.style.maxHeight = "0px";

              const onEnd = (e) => {
                if (e && e.target !== body) return;
                body.removeEventListener("transitionend", onEnd);

                // IMPORTANT: hide after collapse so nothing peeks through
                body.hidden = true;
                body.style.maxHeight = "0px";
                finish();
              };

              if (ms === 0) return onEnd();
              body.addEventListener("transitionend", onEnd, { once: true });
              setTimeout(onEnd, ms + 120);
            });
          };

          // Build wrappers and apply saved state on render
          ensureBucketBodies();

          {
            const state = readState();
            const titles = $tabs.toArray().flatMap(tab => Array.from(tab.querySelectorAll(".inventory-bucket-title")));

            for (const title of titles) {
              const body = title.nextElementSibling;
              if (!body || !body.classList.contains("inventory-bucket-body")) continue;

              const key = getBucketKey(title);
              if (!key) continue;

              const collapsed = state[key] === true;
              const empty = !bucketHasItems(body);
              setChevronState(title, collapsed || empty);

              body.hidden = collapsed || empty;
              body.style.maxHeight = (collapsed || empty) ? "0px" : "";
              body.dataset.animating = "0";
            }
          }

          // Click handler
          $root
            .off("click.mgInvBucketToggle")
            .on("click.mgInvBucketToggle", ".tab-inventory .inventory-bucket-toggle, .tab-gambits .inventory-bucket-toggle, .mg-move-accordion-title .inventory-bucket-toggle", async (ev) => {
              const title = ev.currentTarget.closest(".inventory-bucket-title");
              if (!title) return;
              // The mode class can be on the delegation root, so check it after the click matches.
              if (title.classList.contains("mg-move-accordion-title") && !title.closest(".sheet.actor.is-slim")) return;

              ev.preventDefault();
              ev.stopPropagation();

              // Ignore toggles while searching (your search mode hides titles anyway)
              const tab = ev.currentTarget.closest(".tab-inventory, .tab-gambits");
              const q = tab?.classList?.contains("tab-inventory")
                ? (tab.querySelector(".item-search")?.value || "").trim()
                : "";
              if (q.length) return;

              const body = title.nextElementSibling;
              if (!body || !body.classList.contains("inventory-bucket-body")) return;
              if (body.dataset.animating === "1") return;

              const key = getBucketKey(title);
              if (!key) return;

              if (!bucketHasItems(body)) {
                const state = readState();
                setChevronState(title, true);
                body.hidden = true;
                body.style.maxHeight = "0px";
                body.dataset.animating = "0";
                state[key] = true;
                await writeState(state);
                return;
              }

              const state = readState();
              const collapsed = title.classList.contains("is-collapsed");

              if (!collapsed) {
                // COLLAPSE
                setChevronState(title, true);
                state[key] = true;

                // Animate first, then persist (so even if something rerenders later, it doesn't kill the transition)
                await animateBucket(body, false);
                writeState(state);
                return;
              }

              // EXPAND
              setChevronState(title, false);

              // IMPORTANT: persist open explicitly so it survives hard refresh
              state[key] = false;

              // Animate first, then persist
              await animateBucket(body, true);
              await writeState(state);

            });
        }



      // Initial state: everything visible, no animations, no empty message
      const initialCards = $tab.find(".inventory-card, .inventory-item").toArray();
      for (const el of initialCards) {
        el.classList.remove("is-hidden", "is-entering", "is-leaving", "pre-enter");
        el.style.transitionDelay = "";
      }
      showEmpty(false);
    }


    // "See All / See Less" for inventory cards
    // Uniform collapsed height + infinite expand/collapse using CSS transition on max-height
    {
      const $root = html instanceof jQuery ? html : $(html);

      const DEFAULT_CAP   = 340; // px fallback if no data-seeall-cap
      const TRANSITION_MS = 500; // match your CSS max-height transition (~.5s)

      // Capture-phase listener to bump card height even if inner toggles stopPropagation()
      {
        const rootEl = $root[0];
        if (rootEl) {
          // Remove prior copy if this sheet re-renders
          if (rootEl._mgInvCardBumpCapture) {
            rootEl.removeEventListener("click", rootEl._mgInvCardBumpCapture, true);
          }

          rootEl._mgInvCardBumpCapture = (ev) => {
            const btn = ev.target?.closest?.(
              ".tab-inventory .tags-toggle"
            );
            if (!btn) return;

            const card = btn.closest(".inventory-item.mg-card-wrap, .inventory-card.mg-card-wrap");
            if (!card) return;

            // Let the inner toggle update its own max-height first, then measure
            setTimeout(() => bumpExpandedCard(card), 0);
          };

          rootEl.addEventListener("click", rootEl._mgInvCardBumpCapture, true);
        }
      }

      // Initialize all inventory cards to the same collapsed height
      const initCards = () => {
        const cards =
          $root[0]?.querySelectorAll(
            ".tab-inventory .inventory-item.mg-card-wrap, .tab-inventory .inventory-card.mg-card-wrap"
          ) || [];

        cards.forEach((card) => {
          const capAttr = Number(card.dataset.seeallCap) || DEFAULT_CAP;
          card.dataset.mgCollapsedPx = String(capAttr);

          // If not expanded, force the collapsed height so they all match
          if (!card.classList.contains("expanded")) {
            card.style.overflow = "hidden";
            card.style.maxHeight = `${capAttr}px`;
          } else {
            // If somehow already expanded on render, lock it to its real height
            card.style.overflow = "visible";
            card.style.maxHeight = `${card.scrollHeight}px`;
          }

          const icon = card.querySelector(".card-seeall-toggle i");
          if (icon) icon.classList.toggle("rotated", card.classList.contains("expanded"));
        });
      };

      // While a card is expanded, its contents (Description/Notes toggles) can change height.
      // This bumps the card's maxHeight to match so it "grows" instead of overflowing/clipping.
      const bumpExpandedCard = (card) => {
        if (!card?.classList?.contains("expanded")) return;
        // lock current px, then animate to new scrollHeight
        const start = Math.ceil(card.getBoundingClientRect().height);
        const target = card.scrollHeight;

        card.style.overflow = "hidden";
        card.style.maxHeight = `${start}px`;
        // force reflow
        // eslint-disable-next-line no-unused-expressions
        card.offsetHeight;

        card.style.maxHeight = `${target}px`;

        // once it settles, allow overflow visible again (but KEEP a px maxHeight!)
        setTimeout(() => {
          if (!card.classList.contains("expanded")) return;
          card.style.overflow = "visible";
          card.style.maxHeight = `${card.scrollHeight}px`;
        }, TRANSITION_MS + 50);
      };

      const toggleCard = (btn) => {
        const card = btn.closest(".inventory-item.mg-card-wrap, .inventory-card.mg-card-wrap");
        if (!card) return;

        const icon        = btn.querySelector("i");
        const collapsedPx = Number(card.dataset.mgCollapsedPx) || DEFAULT_CAP;
        const isExpanded  = card.classList.contains("expanded");

        if (!isExpanded) {
          // ===== EXPAND (collapsed px -> full px) =====
          const start  = Math.ceil(card.getBoundingClientRect().height) || collapsedPx;
          const target = card.scrollHeight;

          card.style.overflow  = "hidden";
          card.style.maxHeight = `${start}px`;
          // force reflow
          // eslint-disable-next-line no-unused-expressions
          card.offsetHeight;

          card.style.maxHeight = `${target}px`;
          card.classList.add("expanded");
          if (icon) icon.classList.add("rotated");

          // After expand completes: allow overflow, but KEEP a pixel maxHeight so collapse can animate later
          setTimeout(() => {
            if (!card.classList.contains("expanded")) return;
            card.style.overflow = "visible";
            card.style.maxHeight = `${card.scrollHeight}px`;
          }, TRANSITION_MS + 50);

          return;
        }

        // ===== COLLAPSE (full px -> collapsed px) =====
        // Critical: establish a *pixel* start height (NOT "auto") so CSS can animate.
        const start = Math.ceil(card.getBoundingClientRect().height) || card.scrollHeight;

        card.style.overflow  = "hidden";
        card.style.maxHeight = `${start}px`;

        // force reflow so the browser commits the start value
        // eslint-disable-next-line no-unused-expressions
        card.offsetHeight;

        // animate down
        card.style.maxHeight = `${collapsedPx}px`;
        card.classList.remove("expanded");
        if (icon) icon.classList.remove("rotated");

        // keep the clamp in collapsed state
        setTimeout(() => {
          if (card.classList.contains("expanded")) return;
          card.style.overflow = "hidden";
          card.style.maxHeight = `${collapsedPx}px`;
        }, TRANSITION_MS + 50);
      };

      $root
        .off("click.mgInvCardToggle")
        .on("click.mgInvCardToggle", ".tab-inventory .card-seeall-toggle", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();

          toggleCard(ev.currentTarget);

          // After expand/collapse, re-measure inner Description/Notes so chevrons appear correctly
          setTimeout(() => {
            $root[0]?._mgInvRefreshInnerSeeAll?.();
          }, 0);
        });


      initCards();
    }

    // Tag Overflow (Inventory + Moves) — chevron + smooth reveal
    {
      const $root = html instanceof jQuery ? html : $(html);

      const COLLAPSED_MAX = 44;   // px of tag-stack height before clamping
      const TRANSITION_MS = 500;  // keep in sync with your CSS transition

      // Helper: find the tags container inside a tags-wrap (works for both your layouts)
      const getTagsEl = (wrap) =>
        wrap?.querySelector(".item-tags") ||
        wrap?.querySelector(".tags");

      const ensureTransition = (el) => {
        if (!el) return;
        // If your CSS already sets this, this is harmless.
        if (!el.style.transition) el.style.transition = "max-height 0.5s ease";
        if (!el.style.overflow) el.style.overflow = "hidden";
      };

      const updateOne = (wrap) => {
        if (!wrap || wrap.classList.contains("animating")) return;

        const tagsEl = getTagsEl(wrap);
        const toggle = wrap.querySelector(".tags-toggle");
        if (!tagsEl || !toggle) return;

        ensureTransition(tagsEl);

        const overflows = tagsEl.scrollHeight > (COLLAPSED_MAX + 1);
        const expanded  = wrap.classList.contains("expanded");

        // If it doesn't overflow, mark short + hide toggle + remove clamp
        wrap.classList.toggle("short", !overflows);
        toggle.hidden = !overflows;

        // Make sure we have an icon
        let icon = toggle.querySelector("i");
        if (!icon) {
          toggle.innerHTML = '<i class="fa-solid fa-angle-down"></i>';
          icon = toggle.querySelector("i");
        }
        icon?.classList.toggle("rotated", expanded);

        // Clamp only when collapsed AND overflowing
        if (!expanded && overflows) {
          tagsEl.style.maxHeight = `${COLLAPSED_MAX}px`;
        } else {
          tagsEl.style.maxHeight = "";
        }
      };

      const refreshAll = () => {
        const wraps =
          $root[0]?.querySelectorAll(
            '.tab-inventory .tags-wrap, .tab-moves .tags-wrap'
          ) || [];
        wraps.forEach(updateOne);
      };

      // Expose for tab-click remeasure (your tab click handler already calls this)
      $root[0]._mgRefreshTagsOverflow = refreshAll;

      // Also re-measure once after layout settles (fonts, rich text, etc.)
      setTimeout(refreshAll, 0);

      // Click handler for BOTH tabs
      $root
        .off("click.mgTagsToggle")
        .on("click.mgTagsToggle", ".tab-inventory .tags-toggle, .tab-moves .tags-toggle", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();

          const toggle = ev.currentTarget;
          const wrap   = toggle.closest(".tags-wrap");
          const tagsEl = getTagsEl(wrap);
          const icon   = toggle.querySelector("i");
          if (!wrap || !tagsEl) return;

          ensureTransition(tagsEl);

          const wasExpanded = wrap.classList.contains("expanded");
          const startHeight = tagsEl.clientHeight;

          // Expanding: go to scrollHeight
          // Collapsing: go back to COLLAPSED_MAX
          const targetHeight = wasExpanded
            ? COLLAPSED_MAX
            : Math.max(tagsEl.scrollHeight, startHeight);

          // Animate max-height start -> target
          tagsEl.style.maxHeight = `${startHeight}px`;
          // force reflow
          // eslint-disable-next-line no-unused-expressions
          tagsEl.offsetHeight;
          tagsEl.style.maxHeight = `${targetHeight}px`;

          wrap.classList.add("animating");
          wrap.classList.toggle("expanded", !wasExpanded);
          icon?.classList.toggle("rotated", !wasExpanded);

          const onEnd = (e) => {
            if (e && e.target !== tagsEl) return;

            tagsEl.removeEventListener("transitionend", onEnd);
            wrap.classList.remove("animating");

            // Expanded = let it auto-size, Collapsed = keep clamp if it still overflows
            if (wrap.classList.contains("expanded")) {
              tagsEl.style.maxHeight = "";
            } else if (tagsEl.scrollHeight > COLLAPSED_MAX + 1) {
              tagsEl.style.maxHeight = `${COLLAPSED_MAX}px`;
            } else {
              tagsEl.style.maxHeight = "";
            }

            updateOne(wrap);
          };

          tagsEl.addEventListener("transitionend", onEnd, { once: true });
          setTimeout(onEnd, TRANSITION_MS + 100); // failsafe
        });

      // Initial measurement when the sheet renders
      refreshAll();
    }

    // Description / Notes inner "See All" (mg-seeall-wrap)
    {
      const $root = html instanceof jQuery ? html : $(html);

      const DEFAULT_CAP   = 140;  // px fallback if data-seeall-cap is missing
      const TRANSITION_MS = 500;  // keep in sync with CSS max-height transition

      const setupOne = (wrap) => {
        if (!wrap) return;

        const capAttr  = Number(wrap.dataset.seeallCap) || DEFAULT_CAP;
        const content  = wrap.querySelector(".mg-seeall-content");
        const toggle   = wrap.querySelector(".mg-seeall-toggle");
        if (!content || !toggle) return;

        const overflows = content.scrollHeight > (capAttr + 1);

        // Hide toggle if no overflow, remove clamp
        wrap.classList.toggle("short", !overflows);

        if (!toggle.querySelector("i")) {
          toggle.innerHTML = '<i class="fa-solid fa-angle-down"></i>';
        }
        const icon = toggle.querySelector("i");

        const expanded = wrap.classList.contains("expanded");

        if (!expanded && overflows) {
          content.style.maxHeight = `${capAttr}px`;
        } else {
          content.style.maxHeight = "";
        }

        if (icon) icon.classList.toggle("rotated", expanded);
      };

      const refreshAll = () => {
        const wraps =
          $root[0]?.querySelectorAll('.tab[data-tab="inventory"] .mg-seeall-wrap, .tab.inventory .mg-seeall-wrap') || [];

        wraps.forEach(setupOne);
      };

      // expose for other listeners (like card expand)
      $root[0]._mgInvRefreshInnerSeeAll = refreshAll;

      $root
        .off("click.mgInnerSeeall")
        .on("click.mgInnerSeeall", '.tab[data-tab="inventory"] .mg-seeall-toggle, .tab.inventory .mg-seeall-toggle', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();

          const wrap = ev.currentTarget.closest(".mg-seeall-wrap");
          const content = wrap?.querySelector(".mg-seeall-content");
          const icon = ev.currentTarget.querySelector("i");
          if (!wrap || !content || wrap.classList.contains("animating")) return;

          const capAttr    = Number(wrap.dataset.seeallCap) || DEFAULT_CAP;
          const wasExpanded = wrap.classList.contains("expanded");

          const startHeight = content.clientHeight;
          const targetHeight = wasExpanded
            ? capAttr
            : Math.max(content.scrollHeight, startHeight);

          // Follow the description's animated height without a second card transition.
          const card = wrap.closest(".inventory-item.mg-card-wrap, .inventory-card.mg-card-wrap");
          if (card?.classList.contains("expanded")) card.style.maxHeight = "none";

          // Start from current height
          content.style.maxHeight = `${startHeight}px`;
          // force reflow so browser commits it
          // eslint-disable-next-line no-unused-expressions
          content.offsetHeight;
          content.style.maxHeight = `${targetHeight}px`;

          wrap.classList.add("animating");
          wrap.classList.toggle("expanded", !wasExpanded);
          if (icon) icon.classList.toggle("rotated", !wasExpanded);

          const onEnd = (e) => {
            if (e && e.target !== content) return;

            content.removeEventListener("transitionend", onEnd);
            wrap.classList.remove("animating");

            const nowExpanded = wrap.classList.contains("expanded");

            if (nowExpanded) {
              // Let it auto-size after the expand transition
              content.style.maxHeight = "";
            } else {
              // Re-apply clamp if it still overflows
              if (content.scrollHeight > capAttr + 1) {
                content.style.maxHeight = `${capAttr}px`;
              } else {
                content.style.maxHeight = "";
              }
            }
          };

          content.addEventListener("transitionend", onEnd, { once: true });
          setTimeout(onEnd, TRANSITION_MS + 100); // failsafe
        });

      // Initial clamp / toggle visibility on render
      refreshAll();
    }

}
