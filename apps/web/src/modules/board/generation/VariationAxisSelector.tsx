import type {
  CollectionDna,
  CollectionVariationAxis,
} from "./collection-types";
import styles from "./generation.module.css";

const AXES: readonly {
  readonly description: string;
  readonly label: string;
  readonly value: CollectionVariationAxis;
}[] = [
  {
    description: "改变体量、比例与结构线",
    label: "廓形",
    value: "silhouette",
  },
  {
    description: "替换材质触感与垂坠方式",
    label: "面料",
    value: "fabric",
  },
  {
    description: "调整主辅色关系",
    label: "色彩",
    value: "color",
  },
  {
    description: "发展领口、开合与局部构造",
    label: "细节",
    value: "detail",
  },
  {
    description: "改变搭配层次与造型方式",
    label: "造型",
    value: "styling",
  },
];

export function VariationAxisSelector({
  disabled,
  dna,
  onChange,
  value,
}: {
  readonly disabled?: boolean;
  readonly dna: CollectionDna;
  readonly onChange: (axis: CollectionVariationAxis) => void;
  readonly value: CollectionVariationAxis;
}) {
  return (
    <fieldset className={styles.axisSelector} disabled={disabled}>
      <legend>
        <span>VARIATION AXIS</span>
        选择本次变化轴
      </legend>
      <div>
        {AXES.map((axis) => {
          const locked = axisLocked(axis.value, dna);
          return (
            <label
              data-locked={locked}
              data-selected={value === axis.value}
              key={axis.value}
            >
              <input
                checked={value === axis.value}
                disabled={disabled || locked}
                name="collection-variation-axis"
                onChange={() => onChange(axis.value)}
                type="radio"
                value={axis.value}
              />
              <strong>{axis.label}</strong>
              <small>{locked ? "DNA 已锁定" : axis.description}</small>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function axisLocked(
  axis: CollectionVariationAxis,
  dna: CollectionDna,
): boolean {
  if (axis === "color") return dna.locks.palette;
  if (axis === "silhouette") return dna.locks.silhouettes;
  if (axis === "fabric") return dna.locks.fabrics;
  if (axis === "styling") return dna.locks.moodWords;
  return false;
}
