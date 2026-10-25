import { CandidateCard, type VariantProps } from "./shared";
import styles from "./prototype.module.css";
export function MatrixVariant(props: VariantProps) {
  return (
    <section aria-label="矩阵总览" className={styles.matrix}>
      {props.items.map((item) => (
        <CandidateCard key={item.id} item={item} {...props} />
      ))}
    </section>
  );
}
