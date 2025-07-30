const { Engine } = require("json-rules-engine");
// const rules = require("./rules.json");
// engine.addRule(rules);

const engine = new Engine();
engine.addOperator("earlierThan", (roadworkDate1, roadworkDate2) => {
  const date1 = new Date(roadworkDate1);
  const date2 = new Date(roadworkDate2);

  return date1 < date2;
});

/*

Facts are inputs to rules
Engines take facts and rules and runs rules on the facts
Almanac is basically a cache

5 days buffer between each road work

1. Highest priority always goes first.
    - if same priority:
        - earliest date goes first
            - later date is then brought forward to 5 days after earliest date ends
        
            - if dates overlap/start date is the same:
                - overall shorter duration goes first

2. Priority 5 HAS to go to the end of the quarter
    - if multiple priority 5:
        - push all to end of quarter
        - road works that exceed quarter are marked as spillover

3. Blocked out dates (like PH) need to be compensated - probably need a global blockedOutDates
*/

// Input facts
const facts = [
  {
    name: "A",
    priority: 1,
    proposedStart: "2025-08-01",
    proposedEnd: "2025-08-05",
    duration: "5",
    clashesWith: ["B"],
  },
  {
    name: "B",
    priority: 1,
    proposedStart: "2025-08-03",
    proposedEnd: "2025-08-07",
    duration: "5",
    clashesWith: ["A", "C"],
  },
  {
    name: "C",
    priority: 2,
    proposedStart: "2025-08-06",
    proposedEnd: "2025-08-11",
    duration: "6",
    clashesWith: ["B"],
  },
];

// We assign weights to each roadwork and increment each roadowrk's weight every time it wins a comparison.
const weights = {};
const seenPairs = new Set();

// =============== 1. Priorirty rule - check for diff priority =========
facts.forEach((roadwork) => {
  weights[roadwork.name] = 5 - roadwork.priority;
});

// ================ 2. Date overlap rule - check for no overlap in dates ==========
const dateOverlapRule = {
  conditions: {
    all: [
      {
        fact: "roadwork",
        path: "$.priority",
        operator: "equal",
        value: {
          fact: "other",
          path: "$.priority",
        },
      },
      {
        fact: "roadwork",
        path: "$.proposedEnd",
        operator: "earlierThan",
        value: {
          fact: "other",
          path: "$.proposedStart",
        },
      },
    ],
  },
  event: {
    type: "first-by-earlier-date",
    params: {
      first: "roadwork",
      last: "other",
    },
  },
  priority: 9,
  onSuccess: async function (event, almanac) {
    const roadwork = await almanac.factValue("roadwork");
    weights[roadwork.name] = weights[roadwork.name] + 1;
  },
  onFailure: async function (event, almanac) {
    const roadwork = await almanac.factValue("roadwork");
    const other = await almanac.factValue("other");

    if (roadwork.priority === other.priority) {
      weights[other.name] = weights[other.name] + 1;
    }
  },
};

engine.addRule(dateOverlapRule);

// ================ 2. Duration rule - check for different duration while priority same and dates overlap ==========
const durationRule = {
  conditions: {
    all: [
      {
        fact: "roadwork",
        path: "$.priority",
        operator: "equal",
        value: {
          fact: "other",
          path: "$.priority",
        },
      },
      {
        not: {
          fact: "roadwork",
          path: "$.proposedEnd",
          operator: "earlierThan",
          value: {
            fact: "other",
            path: "$.proposedStart",
          },
        },
      },
      {
        fact: "roadwork",
        path: "$.duration",
        operator: "lessThan",
        value: {
          fact: "other",
          path: "$.duration",
        },
      },
    ],
  },
  event: {
    type: "first-by-shorter-duration",
    params: {
      first: "roadwork",
      last: "other",
    },
  },
  priority: 8,
  onSuccess: async function (event, almanac) {
    const roadwork = await almanac.factValue("roadwork");
    weights[roadwork.name] = weights[roadwork.name] + 1;
  },
  onFailure: async function (event, almanac) {
    const roadwork = await almanac.factValue("roadwork");
    const other = await almanac.factValue("other");

    if (roadwork.priority === other.priority) {
      // HELPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
      weights[other.name] = weights[other.name] + 1;
    }
  },
};

(async () => {
  for (let i = 0; i < facts.length; i++) {
    const currRoadwork = facts[i];
    if (currRoadwork.clashesWith) {
      // can't use .forEach here => that's a synchronous loop
      for (const otherName of currRoadwork.clashesWith) {
        const otherRoadwork = facts.find((f) => f.name === otherName);

        if (otherRoadwork) {
          const pairKey = [currRoadwork.name, otherRoadwork.name]
            .sort()
            .join("-");

          if (seenPairs.has(pairKey)) continue;
          seenPairs.add(pairKey);
          await engine.run({ roadwork: currRoadwork, other: otherRoadwork });
        }
      }
    }
  }

  // Sort by weight (higher wins)
  const scheduled = [...facts].sort(
    (a, b) => (weights[b.name] || 0) - (weights[a.name] || 0)
  );

  console.log("\n Final Schedule (sorted by weight):");
  scheduled.forEach((roadwork, index) => {
    console.log(
      `${index + 1}. ${roadwork.name} (Priority ${roadwork.priority}, Weight ${
        weights[roadwork.name] || 0
      })`
    );
  });
})();
