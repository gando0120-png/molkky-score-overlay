/**
 * SMAScore — 試合形式・勝利条件
 */
(function () {
  function parseFormat(format) {
    if (!format) return { type: "wins", target: 2 };

    const winMatch = String(format).match(/^win-(\d+)$/);
    if (winMatch) {
      return { type: "wins", target: Number(winMatch[1]) };
    }

    const gameMatch = String(format).match(/^(game|total)-(\d+)$/);
    if (gameMatch) {
      return { type: "games", target: Number(gameMatch[2]) };
    }

    return { type: "wins", target: 2 };
  }

  function totalSetWins(teams) {
    return teams.reduce((sum, team) => sum + (team.setWins || 0), 0);
  }

  /**
   * セット勝利を加算した直後に試合終了か判定する
   * @param {object[]} teams
   * @param {number} setWinnerIndex
   * @param {string} format
   * @returns {{ ended: boolean, winnerIndex: number|null }}
   */
  function evaluateMatchEnd(teams, setWinnerIndex, format) {
    const spec = parseFormat(format);
    const projectedWins = teams.map((team, index) =>
      index === setWinnerIndex ? team.setWins + 1 : team.setWins
    );

    if (spec.type === "wins") {
      for (let i = 0; i < projectedWins.length; i += 1) {
        if (projectedWins[i] >= spec.target) {
          return { ended: true, winnerIndex: i };
        }
      }
      return { ended: false, winnerIndex: null };
    }

    const setsAfter = totalSetWins(teams) + 1;
    if (setsAfter >= spec.target) {
      const maxWins = Math.max(...projectedWins);
      const leaders = projectedWins
        .map((wins, index) => (wins === maxWins ? index : -1))
        .filter((index) => index >= 0);

      return {
        ended: true,
        winnerIndex: leaders.length === 1 ? leaders[0] : setWinnerIndex,
      };
    }

    return { ended: false, winnerIndex: null };
  }

  /**
   * 現在の setWins から試合終了状態を再計算（Undo / 履歴再計算用）
   */
  function recomputeMatchEnd(teams, format) {
    const spec = parseFormat(format);

    if (spec.type === "wins") {
      for (let i = 0; i < teams.length; i += 1) {
        if (teams[i].setWins >= spec.target) {
          return { ended: true, winnerIndex: i };
        }
      }
      return { ended: false, winnerIndex: null };
    }

    if (totalSetWins(teams) >= spec.target) {
      const maxWins = Math.max(...teams.map((team) => team.setWins));
      const leaders = teams
        .map((team, index) => (team.setWins === maxWins ? index : -1))
        .filter((index) => index >= 0);

      return {
        ended: true,
        winnerIndex: leaders.length === 1 ? leaders[0] : leaders[0],
      };
    }

    return { ended: false, winnerIndex: null };
  }

  window.SMAScoreMatchRules = {
    parseFormat,
    evaluateMatchEnd,
    recomputeMatchEnd,
    totalSetWins,
  };
})();
