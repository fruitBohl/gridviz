from dataclasses import dataclass
from math import sqrt
from typing import Any, cast

import pyomo.environ as pyo

INTERVAL_HOURS = 5 / 60


@dataclass(frozen=True)
class Schedule:
    revenue: float
    charge_mw: list[float]
    discharge_mw: list[float]
    stored_mwh: list[float]

@dataclass(frozen=True)
class Battery:
    power_mw: float = 100.0
    energy_mwh: float = 200.0
    round_trip_efficiency: float = 0.88
    start_soc_mwh: float = 100.0

    def __post_init__(self):
        if self.power_mw <= 0 or self.energy_mwh <= 0:
            raise ValueError("power_mw and energy_mwh must be positive")
        if not 0 < self.round_trip_efficiency <= 1:
            raise ValueError("round_trip_efficiency must be in (0, 1]")
        if not 0 <= self.start_soc_mwh <= self.energy_mwh:
            raise ValueError("start_soc_mwh must be between 0 and energy_mwh")

    @property
    def leg_efficiency(self) -> float:
        # Assume losses are split between charging and discharging.
        return sqrt(self.round_trip_efficiency)

def build_model(prices: list[float], battery: Battery, relax: bool = False) -> pyo.ConcreteModel:    

    # Type checker can't handler Pyomo's dynamic components (surely there's a better way)
    m = cast(Any, pyo.ConcreteModel())

    m.timesteps = pyo.RangeSet(0, len(prices) - 1)
    m.prices = pyo.Param(m.timesteps, initialize=dict(enumerate(prices)))

    m.charge = pyo.Var(m.timesteps, bounds=(0, battery.power_mw))
    m.discharge = pyo.Var(m.timesteps, bounds=(0, battery.power_mw))
    m.stored_mwh = pyo.Var(m.timesteps, bounds=(0, battery.energy_mwh))
    m.mode = pyo.Var(m.timesteps, domain=pyo.UnitInterval if relax else pyo.Binary)

    @m.Constraint(m.timesteps)
    def soc_linking(m, t):
        prev = m.stored_mwh[t - 1] if t > m.timesteps.first() else battery.start_soc_mwh
        return m.stored_mwh[t] == (
            prev + battery.leg_efficiency * m.charge[t] * INTERVAL_HOURS
                 - m.discharge[t] * INTERVAL_HOURS / battery.leg_efficiency
        )
    
    @m.Constraint(m.timesteps)
    def charge_only_in_charge_mode(m, t):
        return m.charge[t] <= battery.power_mw * m.mode[t]
    
    @m.Constraint(m.timesteps)
    def discharge_only_in_discharge_mode(m, t):
        return m.discharge[t] <= battery.power_mw * (1 - m.mode[t])

    m.end_soc = pyo.Constraint(expr=m.stored_mwh[m.timesteps.last()] >= battery.start_soc_mwh)  # pyright: ignore[reportAttributeAccessIssue, reportOperatorIssue]

    m.revenue = pyo.Objective(
        expr=sum(m.prices[t] * (m.discharge[t] - m.charge[t]) * INTERVAL_HOURS for t in m.timesteps),  # pyright: ignore[reportOperatorIssue, reportGeneralTypeIssues]
        sense=pyo.maximize,
    )

    return m


def solve_model(prices: list[float], battery: Battery, relax: bool = False) -> Schedule:
    m = cast(Any, build_model(prices, battery, relax))
    results = pyo.SolverFactory("highs").solve(m, options={"mip_rel_gap": 1e-3, "time_limit": 50})

    if not pyo.check_optimal_termination(results):
        raise RuntimeError(f"Battery model not solved to optimality: {results.solver.termination_condition}")

    def values(var: Any) -> list[float]:
        return [var[t].value for t in m.timesteps]

    return Schedule(
        revenue=m.revenue(),
        charge_mw=values(m.charge),
        discharge_mw=values(m.discharge),
        stored_mwh=values(m.stored_mwh),
    )

    