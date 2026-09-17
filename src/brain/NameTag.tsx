/**
 * A name tag: a label in the names column, never the object itself.
 *
 * The tag is drawn as a luggage tag with a notched right edge and an arrow
 * leaving that edge, so rebinding a name visibly moves the tag's arrow while
 * the object it used to point at stays exactly where it was. A draft label is
 * the same shape in the draft palette, dashed, and carries the literal word
 * "draft": it is not a Python binding and must never be mistaken for one.
 */
import type { BrainInteraction } from './BrainWorkspace'
import type { NameTagLayout } from './layout'

export interface NameTagProps {
  tag: NameTagLayout
  /** Sentence naming what this tag refers to, for screen readers. */
  description: string
  descriptionId: string
  interaction: BrainInteraction
}

export function NameTag({ tag, description, descriptionId, interaction }: NameTagProps) {
  const style = { left: tag.x, top: tag.y, width: tag.width, height: tag.height }
  const key = `name:${tag.key}`

  if (tag.draft) {
    return (
      <button
        type="button"
        className="name-tag"
        data-draft="true"
        style={style}
        aria-disabled="true"
        aria-describedby={descriptionId}
        tabIndex={interaction.activeKey === key ? 0 : -1}
        ref={(el) => interaction.register(key, el)}
        data-brain-key={key}
      >
        <span className="name-tag-text">{tag.name}</span>
        <span className="name-tag-draft-word" aria-hidden="true">draft</span>
        <span className="brain-sr" id={descriptionId}>{description}</span>
      </button>
    )
  }

  const reference = tag.reference
  const selected = interaction.isSelected(reference)
  const pickable = interaction.isPickable(reference)
  const blocked = interaction.isBlocked(reference)

  return (
    <button
      type="button"
      className="name-tag"
      style={style}
      data-selected={selected}
      data-pick={pickable}
      data-blocked={blocked}
      aria-disabled={blocked || undefined}
      aria-describedby={descriptionId}
      tabIndex={interaction.activeKey === key ? 0 : -1}
      ref={(el) => interaction.register(key, el)}
      data-brain-key={key}
      onClick={() => interaction.activate(reference)}
    >
      <span className="name-tag-text">{tag.name}</span>
      {selected && <span className="name-tag-mark" aria-hidden="true">✓</span>}
      {!selected && pickable && <span className="name-tag-mark" aria-hidden="true">›</span>}
      <span className="brain-sr" id={descriptionId}>
        {description}
        {selected ? '. Picked.' : ''}
        {blocked ? '. Not one of the things to pick right now.' : ''}
      </span>
    </button>
  )
}
