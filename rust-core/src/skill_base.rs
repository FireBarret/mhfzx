//! Skill activation lookup — the tiered `SkillBase.GetOption` algorithm.
//!
//! Ground truth: docs/rules-spec.md §2 ("Skill point summation / activation
//! math"), citing `SkillBase.cs:22-40`:
//! ```csharp
//! int num2 = ((point >= 0) ? 1 : (-1));
//! foreach (SkillOption item in OptionTable) {
//!     if ((num2 < 0 || item.Point >= 0) && (num2 >= 0 || item.Point < 0)) {
//!         int num3 = num2 * (point - item.Point);
//!         if (num3 < num && num3 >= 0) { num = num3; result = item; }
//!     }
//! }
//! ```
//! This is *not* "total points >= threshold" — it finds, among options whose
//! sign matches the running total's sign, the option whose threshold is
//! nearest to (at or below) the actual total on the same side of zero.

use crate::schema::{SkillBaseEntry, SkillOption};

/// Faithful port of `SkillBase.GetOption`: the option in `entry.options`
/// nearest to (at or below, same sign) `point`, or `None` if `point` is 0 or
/// no option qualifies.
pub fn get_option(entry: &SkillBaseEntry, point: i32) -> Option<&SkillOption> {
    if point == 0 {
        return None;
    }
    let sign: i32 = if point >= 0 { 1 } else { -1 };
    let mut best: Option<&SkillOption> = None;
    let mut best_distance = i32::MAX;

    for item in &entry.options {
        let same_side = (sign < 0 || item.point >= 0) && (sign >= 0 || item.point < 0);
        if !same_side {
            continue;
        }
        let distance = sign * (point - item.point);
        if distance < best_distance && distance >= 0 {
            best_distance = distance;
            best = Some(item);
        }
    }

    best
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::SkillOption;

    fn health_skill() -> SkillBaseEntry {
        // Real ladder from dat/SkillBase.xml, cited in docs/rules-spec.md.
        SkillBaseEntry {
            no: 31,
            id: "0950".into(),
            name: "Health".into(),
            skill_rank: false,
            options: vec![
                SkillOption {
                    name: "Health +50".into(),
                    point: 40,
                },
                SkillOption {
                    name: "Health +40".into(),
                    point: 30,
                },
                SkillOption {
                    name: "Health +30".into(),
                    point: 20,
                },
                SkillOption {
                    name: "Health +20".into(),
                    point: 15,
                },
                SkillOption {
                    name: "Health +10".into(),
                    point: 10,
                },
                SkillOption {
                    name: "Health -10".into(),
                    point: -10,
                },
                SkillOption {
                    name: "Health -20".into(),
                    point: -15,
                },
                SkillOption {
                    name: "Health -30".into(),
                    point: -20,
                },
            ],
        }
    }

    #[test]
    fn zero_points_is_inactive() {
        assert!(get_option(&health_skill(), 0).is_none());
    }

    #[test]
    fn exact_tier_match() {
        assert_eq!(get_option(&health_skill(), 10).unwrap().name, "Health +10");
        assert_eq!(get_option(&health_skill(), 40).unwrap().name, "Health +50");
    }

    #[test]
    fn between_tiers_picks_nearest_at_or_below() {
        // Tier *labels* aren't their thresholds: "+20" needs 15, "+30" needs 20.
        // 17 clears the "+20" threshold (15) but not "+30"'s (20) -> "+20" tier.
        assert_eq!(get_option(&health_skill(), 17).unwrap().name, "Health +20");
        // 25 clears "+30"'s threshold (20), which is nearer than "+20"'s (15).
        assert_eq!(get_option(&health_skill(), 25).unwrap().name, "Health +30");
    }

    #[test]
    fn below_lowest_positive_tier_is_inactive() {
        // 5 is below the lowest positive threshold (10) -> no positive option.
        assert!(get_option(&health_skill(), 5).is_none());
    }

    #[test]
    fn negative_side_uses_negative_tiers_only() {
        assert_eq!(get_option(&health_skill(), -10).unwrap().name, "Health -10");
        // Same label/threshold mismatch as the positive side: "-30" needs -20,
        // which is nearer to -25 than "-20" (needs -15) or "-10" (needs -10).
        assert_eq!(get_option(&health_skill(), -25).unwrap().name, "Health -30");
    }

    #[test]
    fn far_above_max_tier_still_resolves_to_max_tier() {
        assert_eq!(get_option(&health_skill(), 999).unwrap().name, "Health +50");
    }
}
