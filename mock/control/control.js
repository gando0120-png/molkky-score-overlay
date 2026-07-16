/**
 * SMAScore Control — 失格・セット/試合終了・修正モード・Firebase同期
 */
(function () {
  const inputDisplay = document.getElementById("inputDisplay");
  const inputDisplayLabel = document.querySelector(".input-display__label");
  const teamNameEl = document.getElementById("teamName");
  const tournamentNameEl = document.getElementById("tournamentName");
  const matchNameEl = document.getElementById("matchName");
  const formatWrapEl = document.getElementById("formatWrap");
  const formatLabelEl = document.getElementById("formatLabel");
  const inputTeamBanner = document.getElementById("inputTeamBanner");
  const teamBoardEl = document.getElementById("teamBoard");
  const keypadEl = document.getElementById("keypad");
  const confirmBtn = document.getElementById("confirmBtn");
  const backBtn = document.getElementById("backBtn");
  const nextSetBtn = document.getElementById("nextSetBtn");
  const editModeBtn = document.getElementById("editModeBtn");
  const historyPanel = document.getElementById("historyPanel");
  const historyListEl = document.getElementById("historyList");
  const setScoreLeftEl = document.getElementById("setScoreLeft");
  const setScoreRightEl = document.getElementById("setScoreRight");
  const keys = document.querySelectorAll(".key[data-value]");
  const settingsBtn = document.querySelector(".header__settings");
  const controlEl = document.querySelector(".control");
  const settingsModal = document.getElementById("settingsModal");
  const settingsBackdrop = document.getElementById("settingsBackdrop");
  const settingsCloseBtn = document.getElementById("settingsCloseBtn");
  const settingsCancelBtn = document.getElementById("settingsCancelBtn");
  const settingsForm = document.getElementById("settingsForm");
  const settingsNewMatchBtn = document.getElementById("settingsNewMatchBtn");
  const settingsTournamentInput = document.getElementById("settingsTournament");
  const settingsMatchInput = document.getElementById("settingsMatch");
  const settingsTeamNamesFieldset = document.getElementById("settingsTeamNames");
  const settingsShowTournamentInput = document.getElementById("settingsShowTournament");
  const settingsShowMatchInput = document.getElementById("settingsShowMatch");
  const settingsScoreAnimationInput = document.getElementById("settingsScoreAnimation");
  const throwOrderPanel = document.getElementById("throwOrderPanel");
  const swapOrderBtn = document.getElementById("swapOrderBtn");
  const throwOrderTeamsEl = document.getElementById("throwOrderTeams");

  const matchConfig = window.SMAScoreMatchConfig?.load();
  if (!matchConfig) {
    window.location.href = "../setup/";
    return;
  }

  const META = {
    tournament: matchConfig.tournament,
    match: matchConfig.match,
    format: matchConfig.format,
    teamCount: matchConfig.teamCount,
  };

  const teams = matchConfig.teamNames.map((name) => ({
    name,
    score: 0,
    total: 0,
    misses: 0,
    won: false,
    disqualified: false,
    setWins: 0,
  }));

  let activeTeamIndex = 0;
  let setStartTeamIndex = 0;
  let pendingSelection = null;
  let setEnded = false;
  let setWinnerIndex = null;
  let matchEnded = false;
  let matchWinnerIndex = null;
  const history = [];
  const throwLog = [];

  let editMode = false;
  let selectedEditIndex = null;
  let pendingEditSelection = null;
  let settingsOpen = false;
  let isApplyingRemote = false;
  let suppressPublish = true;
  let localRevision = 0;

  let overlaySettings = window.SMAScoreOverlaySettings?.load() ?? {
    showTournament: true,
    showMatch: true,
    backgroundOpacity: "standard",
    scoreAnimation: true,
  };

  function isOrderEntry(entry) {
    return entry?.kind === "order";
  }

  function normalizeSelection(selection) {
    if (selection === "miss" || selection === null || selection === undefined) {
      return 0;
    }
    return selection;
  }

  function cloneTeams() {
    return teams.map((team) => ({ ...team }));
  }

  function cloneThrowLog() {
    return throwLog.map((entry) => ({ ...entry }));
  }

  function snapshot() {
    return {
      teams: cloneTeams(),
      activeTeamIndex,
      setStartTeamIndex,
      setEnded,
      setWinnerIndex,
      matchEnded,
      matchWinnerIndex,
      throwLog: cloneThrowLog(),
    };
  }

  function restoreState(state) {
    teams.length = 0;
    state.teams.forEach((team) => teams.push({ ...team }));
    activeTeamIndex = state.activeTeamIndex;
    setStartTeamIndex = state.setStartTeamIndex;
    setEnded = state.setEnded;
    setWinnerIndex = state.setWinnerIndex;
    matchEnded = !!state.matchEnded;
    matchWinnerIndex = state.matchWinnerIndex ?? null;
    throwLog.length = 0;
    state.throwLog.forEach((entry) => throwLog.push({ ...entry }));
  }

  function getActiveTeam() {
    return teams[activeTeamIndex];
  }

  function getRemainingTeamIndices() {
    return teams.map((team, index) => (!team.disqualified ? index : -1)).filter((index) => index >= 0);
  }

  function getNextActiveIndex(fromIndex) {
    const total = teams.length;
    for (let step = 1; step <= total; step += 1) {
      const index = (fromIndex + step) % total;
      if (!teams[index].disqualified) {
        return index;
      }
    }
    return fromIndex;
  }

  function applyFiftyRule(score) {
    if (score > 50) {
      return 25;
    }
    return score;
  }

  function applySelection(team, selection) {
    const value = normalizeSelection(selection);

    if (value >= 1 && value <= 12) {
      team.score = applyFiftyRule(team.score + value);
      team.misses = 0;
      team.won = team.score === 50;
      return;
    }

    if (value === 0) {
      team.misses = Math.min(3, team.misses + 1);
      if (team.misses >= 3) {
        team.disqualified = true;
        team.score = 0;
        team.won = false;
      }
      return;
    }

    if (value === "F") {
      if (team.score >= 37) {
        team.score = 25;
        team.won = false;
      }
      team.misses = 0;
    }
  }

  function addCurrentScoresToTotals() {
    teams.forEach((team) => {
      const finalScore = team.disqualified ? 0 : team.score;
      team.total += finalScore;
    });
  }

  function setWinnerAtFifty(winnerIndex) {
    const winner = teams[winnerIndex];
    winner.score = 50;
    winner.won = true;
  }

  function resetSetScores() {
    teams.forEach((team) => {
      team.score = 0;
      team.misses = 0;
      team.won = false;
      team.disqualified = false;
    });
  }

  function rotateSetStartTeam() {
    if (teams.length === 2) {
      setStartTeamIndex = 1 - setStartTeamIndex;
    } else {
      setStartTeamIndex = (setStartTeamIndex + 1) % teams.length;
    }
  }

  function beginSet() {
    activeTeamIndex = setStartTeamIndex;
    setEnded = false;
    setWinnerIndex = null;
    resetSetScores();
  }

  function finishMatch(winnerIndex) {
    matchEnded = true;
    matchWinnerIndex = winnerIndex;
    setEnded = false;
    setWinnerIndex = null;
    pendingSelection = null;
  }

  function applyNextSetTransition(winnerIndex) {
    const matchResult = window.SMAScoreMatchRules?.evaluateMatchEnd(
      teams,
      winnerIndex,
      META.format
    ) ?? { ended: false, winnerIndex: null };

    teams[winnerIndex].setWins += 1;

    if (matchResult.ended) {
      finishMatch(matchResult.winnerIndex);
      return;
    }

    rotateSetStartTeam();
    beginSet();
  }

  function resolveThrowDuringReplay(teamIndex) {
    const team = teams[teamIndex];

    if (team.disqualified) {
      if (teams.length === 2) {
        const winnerIndex = 1 - teamIndex;
        setWinnerAtFifty(winnerIndex);
        return { setEnded: true, winnerIndex };
      }

      const remaining = getRemainingTeamIndices();
      if (remaining.length === 1) {
        setWinnerAtFifty(remaining[0]);
        return { setEnded: true, winnerIndex: remaining[0] };
      }

      activeTeamIndex = getNextActiveIndex(teamIndex);
      return { setEnded: false };
    }

    if (team.score === 50) {
      team.won = true;
      return { setEnded: true, winnerIndex: teamIndex };
    }

    activeTeamIndex = getNextActiveIndex(teamIndex);
    return { setEnded: false };
  }

  function replayMatch() {
    const log = cloneThrowLog();

    teams.forEach((team) => {
      team.score = 0;
      team.misses = 0;
      team.won = false;
      team.disqualified = false;
      team.total = 0;
      team.setWins = 0;
    });

    matchEnded = false;
    matchWinnerIndex = null;
    setStartTeamIndex = 0;
    beginSet();

    for (let i = 0; i < log.length; i += 1) {
      const entry = log[i];

      if (isOrderEntry(entry)) {
        activeTeamIndex = entry.activeTeamIndex;
        if (entry.setStartTeamIndex !== undefined && entry.setStartTeamIndex !== null) {
          setStartTeamIndex = entry.setStartTeamIndex;
        }
        continue;
      }

      activeTeamIndex = entry.teamIndex;
      const team = teams[entry.teamIndex];

      applySelection(team, entry.selection);
      entry.scoreAfter = team.score;

      const result = resolveThrowDuringReplay(entry.teamIndex);

      if (result.setEnded) {
        addCurrentScoresToTotals();
        setEnded = true;
        setWinnerIndex = result.winnerIndex;

        if (i < log.length - 1) {
          applyNextSetTransition(result.winnerIndex);
          if (matchEnded) break;
        }
      }
    }

    if (!matchEnded && window.SMAScoreMatchRules) {
      const recomputed = SMAScoreMatchRules.recomputeMatchEnd(teams, META.format);
      matchEnded = recomputed.ended;
      matchWinnerIndex = recomputed.winnerIndex;
    }

    throwLog.length = 0;
    log.forEach((entry) => throwLog.push({ ...entry }));
  }

  function endSet(winnerIndex) {
    setEnded = true;
    setWinnerIndex = winnerIndex;
    if (teams[winnerIndex].score === 50) {
      teams[winnerIndex].won = true;
    }
    addCurrentScoresToTotals();
    pendingSelection = null;
  }

  function endSetByDisqualification(winnerIndex) {
    setWinnerAtFifty(winnerIndex);
    endSet(winnerIndex);
  }

  function handleDisqualification(dqTeamIndex) {
    if (teams.length === 2) {
      endSetByDisqualification(1 - dqTeamIndex);
      return;
    }

    const remaining = getRemainingTeamIndices();
    if (remaining.length === 1) {
      endSetByDisqualification(remaining[0]);
      return;
    }

    activeTeamIndex = getNextActiveIndex(activeTeamIndex);
  }

  function resolveAfterThrow(teamIndex) {
    const team = teams[teamIndex];

    if (team.disqualified) {
      handleDisqualification(teamIndex);
      return;
    }

    if (team.score === 50) {
      endSet(teamIndex);
      return;
    }

    activeTeamIndex = getNextActiveIndex(activeTeamIndex);
  }

  function formatSelection(selection) {
    if (selection === "F") return "F";
    if (selection === 0 || selection === "miss") return "0";
    return String(selection);
  }

  function formatHistoryEntry(entry) {
    if (isOrderEntry(entry)) {
      const name = teams[entry.activeTeamIndex]?.name ?? `チーム ${entry.activeTeamIndex + 1}`;
      return { teamName: name, input: "順序", score: "→" };
    }

    return {
      teamName: teams[entry.teamIndex]?.name ?? `チーム ${entry.teamIndex + 1}`,
      input: formatSelection(entry.selection),
      score: entry.scoreAfter ?? "-",
    };
  }

  function renderMissDots(misses, disqualified) {
    const count = disqualified ? 3 : misses;

    return [0, 1, 2]
      .map((i) => {
        const on = i < count ? " team-card__miss--on" : "";
        return `<span class="team-card__miss${on}" aria-hidden="true">×</span>`;
      })
      .join("");
  }

  function renderSetHeader() {
    if (teams.length >= 2) {
      setScoreLeftEl.textContent = teams[0].setWins;
      setScoreRightEl.textContent = teams[1].setWins;
    }
  }

  function renderMetaHeader() {
    tournamentNameEl.textContent = META.tournament;
    matchNameEl.textContent = META.match;

    const formatLabel = window.SMAScoreMatchConfig?.formatToLabel(META.format) ?? "";
    if (formatLabel) {
      formatWrapEl.hidden = false;
      formatLabelEl.textContent = formatLabel;
    } else {
      formatWrapEl.hidden = true;
      formatLabelEl.textContent = "";
    }
  }

  function renderTeamBoard() {
    teamBoardEl.className = `team-board team-board--count-${teams.length}`;

    teamBoardEl.innerHTML = teams
      .map((team, index) => {
        const isActive = !editMode && !setEnded && !matchEnded && index === activeTeamIndex;
        const isSetWinner = setEnded && index === setWinnerIndex;
        const isMatchWinner = matchEnded && index === matchWinnerIndex;
        const victoryClass = team.won && !setEnded && !matchEnded ? " team-card__score--victory" : "";
        const dqBadge = team.disqualified
          ? '<span class="team-card__badge">失格</span>'
          : "<span></span>";

        return `
          <article class="team-card team-card--color-${index}${isActive ? " team-card--active" : ""}${team.disqualified ? " team-card--disqualified" : ""}${isSetWinner ? " team-card--set-winner" : ""}${isMatchWinner ? " team-card--match-winner" : ""}" aria-label="${team.name}">
            <div class="team-card__meta">
              <p class="team-card__name">${team.name}</p>
              ${dqBadge}
            </div>
            <div class="team-card__score-row">
              <span class="team-card__score${victoryClass}">${team.score}</span>
              <span class="team-card__total">T <span class="team-card__total-num">${team.total}</span></span>
            </div>
            <div class="team-card__meta">
              <p class="team-card__misses" aria-label="連続ミス">${renderMissDots(team.misses, team.disqualified)}</p>
              <span class="team-card__set-wins">SET <span class="team-card__set-wins-num">${team.setWins}</span></span>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderThrowOrderPanel() {
    if (!throwOrderPanel || !swapOrderBtn) return;

    const blocked = matchEnded || setEnded || editMode || settingsOpen;
    throwOrderPanel.hidden = blocked;

    if (teams.length === 2) {
      swapOrderBtn.hidden = false;
      swapOrderBtn.textContent = "先攻・後攻を入れ替える";
      if (throwOrderTeamsEl) throwOrderTeamsEl.hidden = true;
      swapOrderBtn.disabled = blocked;
      return;
    }

    swapOrderBtn.hidden = true;
    if (!throwOrderTeamsEl) return;

    throwOrderTeamsEl.hidden = blocked;
    throwOrderTeamsEl.innerHTML = teams
      .map((team, index) => {
        const disabled = blocked || team.disqualified || index === activeTeamIndex;
        return `
          <button type="button" class="throw-order__team throw-order__team--color-${index}" data-team-index="${index}" ${disabled ? "disabled" : ""}>
            ${team.name}
          </button>
        `;
      })
      .join("");

    throwOrderTeamsEl.querySelectorAll(".throw-order__team").forEach((button) => {
      button.addEventListener("click", () => {
        changeThrowOrder(Number(button.dataset.teamIndex));
      });
    });
  }

  function renderHistoryList() {
    if (!editMode) return;

    if (throwLog.length === 0) {
      historyListEl.innerHTML = '<p class="history-list__empty">履歴がありません</p>';
      return;
    }

    historyListEl.innerHTML = throwLog
      .map((entry, index) => {
        const formatted = formatHistoryEntry(entry);
        const selected = index === selectedEditIndex ? " history-item--selected" : "";
        return `
          <button type="button" class="history-item${selected}" data-index="${index}">
            <span class="history-item__num">${index + 1}</span>
            <span class="history-item__team">${formatted.teamName}</span>
            <span class="history-item__input">${formatted.input}</span>
            <span class="history-item__score">${formatted.score}</span>
          </button>
        `;
      })
      .join("");

    historyListEl.querySelectorAll(".history-item").forEach((button) => {
      button.addEventListener("click", () => {
        selectedEditIndex = Number(button.dataset.index);
        pendingEditSelection = null;
        renderAll();
      });
    });
  }

  function renderInputTeamBanner() {
    if (setEnded || matchEnded || editMode) {
      inputTeamBanner.classList.add("input-team--hidden");
      return;
    }

    inputTeamBanner.classList.remove("input-team--hidden");
    const colorIndex = activeTeamIndex % 4;
    inputTeamBanner.className = `input-team input-team--color-${colorIndex}`;
    teamNameEl.textContent = getActiveTeam().name;
  }

  function renderInputDisplay() {
    inputDisplay.classList.remove(
      "input-display__value--waiting",
      "input-display__value--entered",
      "input-display__value--foul",
      "input-display__value--set-end",
      "input-display__value--match-end",
      "input-display__value--edit"
    );

    if (editMode) {
      inputDisplayLabel.textContent = "修正入力";

      if (selectedEditIndex === null) {
        inputDisplay.textContent = "履歴を選択";
        inputDisplay.classList.add("input-display__value--edit");
        return;
      }

      if (isOrderEntry(throwLog[selectedEditIndex])) {
        inputDisplay.textContent = "順序変更";
        inputDisplay.classList.add("input-display__value--edit");
        return;
      }

      if (pendingEditSelection === null) {
        inputDisplay.textContent = formatSelection(throwLog[selectedEditIndex].selection);
        inputDisplay.classList.add("input-display__value--entered");
        return;
      }

      if (pendingEditSelection === "F") {
        inputDisplay.textContent = "F";
        inputDisplay.classList.add("input-display__value--foul");
      } else {
        inputDisplay.textContent = formatSelection(pendingEditSelection);
        inputDisplay.classList.add("input-display__value--entered");
      }
      return;
    }

    inputDisplayLabel.textContent = "現在入力";

    if (matchEnded) {
      inputDisplay.textContent = "試合終了";
      inputDisplay.classList.add("input-display__value--match-end");
      return;
    }

    if (setEnded) {
      inputDisplay.textContent = "セット終了";
      inputDisplay.classList.add("input-display__value--set-end");
      return;
    }

    if (pendingSelection === null) {
      inputDisplay.textContent = "入力待ち";
      inputDisplay.classList.add("input-display__value--waiting");
    } else if (pendingSelection === "F") {
      inputDisplay.textContent = "F";
      inputDisplay.classList.add("input-display__value--foul");
    } else if (pendingSelection === "miss" || pendingSelection === 0) {
      inputDisplay.textContent = "0";
      inputDisplay.classList.add("input-display__value--entered");
    } else {
      inputDisplay.textContent = String(pendingSelection);
      inputDisplay.classList.add("input-display__value--entered");
    }
  }

  function renderControls() {
    editModeBtn.classList.toggle("action--edit-on", editMode);
    editModeBtn.textContent = editMode ? "通常モード" : "修正モード";
    historyPanel.hidden = !editMode;

    const inputBlocked = setEnded || matchEnded || editMode || settingsOpen;
    keypadEl.classList.toggle("keypad--disabled", inputBlocked && !(editMode && selectedEditIndex !== null));

    editModeBtn.disabled = settingsOpen || matchEnded;

    if (editMode) {
      nextSetBtn.hidden = true;
      confirmBtn.hidden = false;
      const orderEntry = selectedEditIndex !== null && isOrderEntry(throwLog[selectedEditIndex]);
      confirmBtn.disabled =
        settingsOpen || selectedEditIndex === null || orderEntry || pendingEditSelection === null;
    } else {
      confirmBtn.hidden = setEnded || matchEnded;
      confirmBtn.disabled = settingsOpen || setEnded || matchEnded;
      confirmBtn.textContent = "決定";
      nextSetBtn.hidden = !setEnded || matchEnded;
      nextSetBtn.disabled = settingsOpen || matchEnded;
    }

    backBtn.disabled = history.length === 0 || settingsOpen;
    renderThrowOrderPanel();
  }

  function renderSettingsTeamFields() {
    settingsTeamNamesFieldset.innerHTML = '<legend class="settings-fieldset__legend">チーム名</legend>';

    teams.forEach((team, index) => {
      const field = document.createElement("div");
      field.className = "settings-field";
      field.innerHTML = `
        <label class="settings-field__label" for="settingsTeam${index}">チーム ${index + 1}</label>
        <input class="settings-field__input" type="text" id="settingsTeam${index}" autocomplete="off">
      `;
      field.querySelector("input").value = team.name;
      settingsTeamNamesFieldset.appendChild(field);
    });
  }

  function populateSettingsForm() {
    settingsTournamentInput.value = META.tournament;
    settingsMatchInput.value = META.match;
    renderSettingsTeamFields();
    settingsShowTournamentInput.checked = overlaySettings.showTournament;
    settingsShowMatchInput.checked = overlaySettings.showMatch;
    settingsScoreAnimationInput.checked = overlaySettings.scoreAnimation;

    settingsForm
      .querySelectorAll('input[name="backgroundOpacity"]')
      .forEach((input) => {
        input.checked = input.value === overlaySettings.backgroundOpacity;
      });
  }

  function openSettings() {
    settingsOpen = true;
    populateSettingsForm();
    settingsModal.hidden = false;
    controlEl.classList.add("control--settings-open");
    renderControls();
  }

  function closeSettings() {
    settingsOpen = false;
    settingsModal.hidden = true;
    controlEl.classList.remove("control--settings-open");
    renderControls();
  }

  function readSettingsForm() {
    const backgroundOpacity =
      settingsForm.querySelector('input[name="backgroundOpacity"]:checked')?.value ?? "standard";

    const teamNames = teams.map((_, index) => {
      const input = document.getElementById(`settingsTeam${index}`);
      const value = input?.value.trim();
      return value || `チーム ${index + 1}`;
    });

    return {
      tournament: settingsTournamentInput.value.trim(),
      match: settingsMatchInput.value.trim(),
      teamNames,
      overlaySettings: {
        showTournament: settingsShowTournamentInput.checked,
        showMatch: settingsShowMatchInput.checked,
        backgroundOpacity,
        scoreAnimation: settingsScoreAnimationInput.checked,
      },
    };
  }

  function saveSettings(event) {
    event.preventDefault();

    const data = readSettingsForm();

    META.tournament = data.tournament;
    META.match = data.match;
    data.teamNames.forEach((name, index) => {
      teams[index].name = name;
    });

    overlaySettings = data.overlaySettings;
    window.SMAScoreOverlaySettings?.save(overlaySettings);

    window.SMAScoreMatchConfig?.save({
      tournament: META.tournament,
      match: META.match,
      format: META.format,
      teamCount: META.teamCount,
      teamNames: teams.map((team) => team.name),
    });

    closeSettings();
    renderAll();
  }

  function confirmNewMatch() {
    const ok = window.confirm("現在の試合データは終了します。新しい試合を作成しますか？");
    if (!ok) return;

    if (window.SMAScoreSync?.clear) {
      SMAScoreSync.clear();
    } else {
      try {
        localStorage.removeItem("smascore-game-state");
      } catch {
        /* ignore */
      }
    }

    window.location.href = "../setup/";
  }

  function buildSyncState() {
    return {
      tournament: META.tournament,
      match: META.match,
      format: META.format,
      teamCount: META.teamCount,
      teams: cloneTeams(),
      activeTeamIndex,
      setStartTeamIndex,
      setEnded,
      setWinnerIndex,
      matchEnded,
      matchWinnerIndex,
      pendingSelection: editMode ? pendingEditSelection : pendingSelection,
      throwLog: cloneThrowLog(),
      overlaySettings,
      revision: localRevision,
    };
  }

  function applySyncState(state) {
    if (!state?.teams?.length) return;

    const revision = window.SMAScoreSync?.getRevision(state) ?? 0;
    if (revision <= localRevision) return;

    if (revision > localRevision && pendingSelection !== null) {
      console.warn("[SMAScore Control] Remote update received; pending input cleared.");
    }

    isApplyingRemote = true;
    localRevision = revision;

    if (state.tournament !== undefined) META.tournament = state.tournament;
    if (state.match !== undefined) META.match = state.match;
    if (state.format !== undefined) META.format = state.format;

    teams.length = 0;
    state.teams.forEach((team) => teams.push({ ...team }));

    activeTeamIndex = state.activeTeamIndex ?? 0;
    setStartTeamIndex = state.setStartTeamIndex ?? 0;
    setEnded = !!state.setEnded;
    setWinnerIndex = state.setWinnerIndex ?? null;
    matchEnded = !!state.matchEnded;
    matchWinnerIndex = state.matchWinnerIndex ?? null;

    if (Array.isArray(state.throwLog)) {
      throwLog.length = 0;
      state.throwLog.forEach((entry) => throwLog.push({ ...entry }));
    } else if (revision > 0) {
      console.warn("[SMAScore Control] Remote state lacks throwLog; score display only applied.");
    }

    if (state.overlaySettings) {
      overlaySettings = { ...overlaySettings, ...state.overlaySettings };
    }

    pendingSelection = null;
    pendingEditSelection = null;
    isApplyingRemote = false;

    renderAll({ skipPublish: true });
  }

  function publishSync() {
    if (isApplyingRemote || suppressPublish || !window.SMAScoreSync) return;

    const baseRevision = localRevision;
    const state = buildSyncState();
    localRevision = baseRevision + 1;

    SMAScoreSync.publish(state, { baseRevision }).then((result) => {
      if (result?.committed && result.data) {
        localRevision = SMAScoreSync.getRevision(result.data);
        return;
      }

      if (result?.conflict && result.remote) {
        applySyncState(result.remote);
        return;
      }

      localRevision = baseRevision;
    });
  }

  function renderAll(options) {
    renderMetaHeader();
    renderTeamBoard();
    renderSetHeader();
    renderInputTeamBanner();
    renderInputDisplay();
    renderHistoryList();
    renderControls();

    if (!options?.skipPublish) {
      publishSync();
    }
  }

  function selectValue(value) {
    if (settingsOpen || matchEnded) return;

    if (editMode) {
      if (selectedEditIndex === null || isOrderEntry(throwLog[selectedEditIndex])) return;
      pendingEditSelection = value === "miss" ? 0 : value;
      renderInputDisplay();
      renderControls();
      publishSync();
      return;
    }

    if (setEnded) return;
    pendingSelection = value === "miss" ? "miss" : value;
    renderInputDisplay();
    renderControls();
    publishSync();
  }

  function confirmEdit() {
    if (selectedEditIndex === null || pendingEditSelection === null) return;
    if (isOrderEntry(throwLog[selectedEditIndex])) return;

    history.push(snapshot());

    throwLog[selectedEditIndex].selection = pendingEditSelection;
    replayMatch();

    selectedEditIndex = null;
    pendingEditSelection = null;
    pendingSelection = null;

    renderAll();
  }

  function confirm() {
    if (editMode) {
      confirmEdit();
      return;
    }

    if (setEnded || matchEnded) return;

    const selection = normalizeSelection(pendingSelection);

    history.push(snapshot());

    const teamIndex = activeTeamIndex;
    throwLog.push({
      kind: "throw",
      teamIndex,
      selection,
      scoreAfter: 0,
    });

    applySelection(getActiveTeam(), selection);
    throwLog[throwLog.length - 1].scoreAfter = teams[teamIndex].score;
    pendingSelection = null;

    resolveAfterThrow(teamIndex);
    renderAll();
  }

  function nextSet() {
    if (!setEnded || setWinnerIndex === null || matchEnded) return;

    history.push(snapshot());

    const matchResult = window.SMAScoreMatchRules?.evaluateMatchEnd(
      teams,
      setWinnerIndex,
      META.format
    ) ?? { ended: false, winnerIndex: null };

    teams[setWinnerIndex].setWins += 1;

    if (matchResult.ended) {
      finishMatch(matchResult.winnerIndex);
      renderAll();
      return;
    }

    rotateSetStartTeam();
    beginSet();
    pendingSelection = null;

    renderAll();
  }

  function changeThrowOrder(nextIndex) {
    if (matchEnded || setEnded || editMode || settingsOpen) return;
    if (nextIndex < 0 || nextIndex >= teams.length) return;
    if (teams[nextIndex].disqualified) return;
    if (nextIndex === activeTeamIndex) return;

    const currentName = getActiveTeam().name;
    const nextName = teams[nextIndex].name;
    const ok = window.confirm(
      `投擲順を変更します。\n現在: ${currentName}\n変更後: ${nextName}\n\nよろしいですか？`
    );
    if (!ok) return;

    history.push(snapshot());

    activeTeamIndex = nextIndex;
    if (teams.length === 2) {
      setStartTeamIndex = activeTeamIndex;
    }

    throwLog.push({
      kind: "order",
      activeTeamIndex,
      setStartTeamIndex,
    });

    pendingSelection = null;
    renderAll();
  }

  function swapThrowOrderTwoTeam() {
    changeThrowOrder(1 - activeTeamIndex);
  }

  function back() {
    if (history.length === 0) return;

    restoreState(history.pop());
    pendingSelection = null;
    pendingEditSelection = null;
    selectedEditIndex = null;
    renderAll();
  }

  function toggleEditMode() {
    if (settingsOpen || matchEnded) return;

    editMode = !editMode;
    selectedEditIndex = null;
    pendingEditSelection = null;
    pendingSelection = null;
    renderAll();
  }

  keys.forEach((key) => {
    key.addEventListener("click", () => {
      const raw = key.dataset.value;
      if (raw === "F") {
        selectValue("F");
        return;
      }
      if (raw === "miss") {
        selectValue("miss");
        return;
      }
      selectValue(Number(raw));
    });
  });

  confirmBtn.addEventListener("click", confirm);
  backBtn.addEventListener("click", back);
  nextSetBtn.addEventListener("click", nextSet);
  editModeBtn.addEventListener("click", toggleEditMode);
  swapOrderBtn?.addEventListener("click", swapThrowOrderTwoTeam);

  settingsBtn.addEventListener("click", openSettings);
  settingsCloseBtn.addEventListener("click", closeSettings);
  settingsCancelBtn.addEventListener("click", closeSettings);
  settingsBackdrop.addEventListener("click", closeSettings);
  settingsForm.addEventListener("submit", saveSettings);
  settingsNewMatchBtn.addEventListener("click", confirmNewMatch);

  async function bootstrap() {
    if (!window.SMAScoreSync) {
      suppressPublish = false;
      renderAll();
      return;
    }

    SMAScoreSync.subscribe((state) => {
      if (!state?.teams?.length) return;
      if (SMAScoreSync.getRevision(state) > localRevision) {
        applySyncState(state);
      }
    });

    const remote = await SMAScoreSync.ready(3000);
    const remoteRevision = SMAScoreSync.getRevision(remote);

    if (remote?.teams?.length && remoteRevision > 0) {
      applySyncState(remote);
    } else {
      renderAll({ skipPublish: true });
      const result = await SMAScoreSync.publish(buildSyncState(), { baseRevision: remoteRevision });
      if (result?.committed && result.data) {
        localRevision = SMAScoreSync.getRevision(result.data);
      }
    }

    suppressPublish = false;
  }

  bootstrap();
})();
