/**
 * Action Modal for Secrets Explorer
 */

import { Box, Text } from 'tuiuiu.js'
import type { ActionType } from './types.js'
import {
  services,
  selectedServiceIdx,
  environments,
  selectedEnvIdx,
  secrets,
  selectedSecretIdx,
  actionType,
  actionTargetEnvIdx,
  actionMessage,
  actionError,
  actionLoading,
  inputKey,
  inputValue,
  inputSensitive,
  inputTargetShared,
  inputTargetEnvIdx,
  targetServiceIdx,
  getModalField,
  isMonorepo,
} from './store.js'
import { getEnvColor, maskValue, formatInput } from './utils.js'

const ACTION_LABELS: Record<NonNullable<ActionType>, string> = {
  delete: 'DELETE',
  copy: 'COPY',
  move: 'MOVE',
  promote: 'PROMOTE TO SHARED',
  spread: 'SPREAD TO SERVICES',
  add: 'ADD VARIABLE',
  edit: 'EDIT VALUE',
  deleteAll: 'DELETE ALL SERVICE VARS',
  moveToService: 'MOVE TO SERVICE',
}

const ACTION_COLORS: Record<NonNullable<ActionType>, 'error' | 'info' | 'warning' | 'success' | 'accent'> = {
  delete: 'error',
  copy: 'info',
  move: 'warning',
  promote: 'accent',
  spread: 'success',
  add: 'success',
  edit: 'info',
  deleteAll: 'error',
  moveToService: 'warning',
}

export function ActionModal(): ReturnType<typeof Box> | null {
  const action = actionType()
  const envList = environments()
  const targetIdx = actionTargetEnvIdx()
  const secret = secrets()[selectedSecretIdx()]
  const message = actionMessage()
  const err = actionError()
  const isLoading = actionLoading()
  const currentService = services()[selectedServiceIdx()]

  // Input state for add/edit
  const key = inputKey()
  const value = inputValue()
  const sensitive = inputSensitive()
  const toShared = inputTargetShared()
  const targetEnvIdx = inputTargetEnvIdx()
  const currentField = getModalField()

  if (!action) return null
  if (action !== 'add' && !secret) return null

  const targetEnv = (action === 'copy' || action === 'move') ? envList[targetIdx] : null
  const modalContent: ReturnType<typeof Box>[] = []

  // Title
  modalContent.push(
    Box(
      { flexDirection: 'row', gap: 2, alignItems: 'center' },
      Text({ color: ACTION_COLORS[action], bold: true }, '◆'),
      Text({ color: 'foreground', bold: true }, ACTION_LABELS[action]),
      action !== 'add' && secret ? Text({ color: 'primary', bold: true }, secret.key) : null
    )
  )
  modalContent.push(Box({ height: 1 }))

  // Action-specific content
  if (action === 'add') {
    const keyActive = currentField === 'key'
    const valueActive = currentField === 'value'
    const typeActive = currentField === 'type'
    const targetActive = currentField === 'target'
    const envActive = currentField === 'env'
    const inactiveColor = 'foreground'
    const inactiveDim = true

    // Key input
    modalContent.push(
      Box(
        { flexDirection: 'row', alignItems: 'center' },
        Text({ color: keyActive ? 'primary' : inactiveColor, bold: keyActive, dim: !keyActive && inactiveDim }, keyActive ? '▶ ' : '  '),
        Box({ width: 8 }, Text({ color: keyActive ? 'primary' : inactiveColor, dim: !keyActive && inactiveDim }, 'Key:')),
        Text({ color: keyActive ? 'primary' : 'foreground', bold: keyActive, inverse: keyActive }, formatInput(key, 30, keyActive))
      )
    )

    // Value input
    modalContent.push(
      Box(
        { flexDirection: 'row', alignItems: 'center' },
        Text({ color: valueActive ? 'primary' : inactiveColor, bold: valueActive, dim: !valueActive && inactiveDim }, valueActive ? '▶ ' : '  '),
        Box({ width: 8 }, Text({ color: valueActive ? 'primary' : inactiveColor, dim: !valueActive && inactiveDim }, 'Value:')),
        Text({ color: valueActive ? 'primary' : 'foreground', bold: valueActive, inverse: valueActive }, formatInput(value, 30, valueActive))
      )
    )

    modalContent.push(Box({ height: 1 }))

    // Type toggle
    modalContent.push(
      Box(
        { flexDirection: 'row', alignItems: 'center' },
        Text({ color: typeActive ? 'primary' : inactiveColor, bold: typeActive, dim: !typeActive && inactiveDim }, typeActive ? '▶ ' : '  '),
        Box({ width: 8 }, Text({ color: typeActive ? 'primary' : inactiveColor, dim: !typeActive && inactiveDim }, 'Type:')),
        Text({ color: !sensitive ? 'success' : inactiveColor, bold: !sensitive, dim: sensitive && inactiveDim }, !sensitive ? '● ' : '○ '),
        Text({ color: !sensitive ? 'success' : inactiveColor, dim: sensitive && inactiveDim }, 'CONFIG'),
        Text({ color: inactiveColor, dim: inactiveDim }, '  '),
        Text({ color: sensitive ? 'warning' : inactiveColor, bold: sensitive, dim: !sensitive && inactiveDim }, sensitive ? '● ' : '○ '),
        Text({ color: sensitive ? 'warning' : inactiveColor, dim: !sensitive && inactiveDim }, 'SECRET')
      )
    )

    // Target toggle (shared vs service)
    if (currentService?.name !== '[SHARED]') {
      const svcName = currentService?.name || 'SERVICE'
      const svcDisplay = svcName.length > 12 ? svcName.substring(0, 11) + '…' : svcName
      modalContent.push(
        Box(
          { flexDirection: 'row', alignItems: 'center' },
          Text({ color: targetActive ? 'primary' : inactiveColor, bold: targetActive, dim: !targetActive && inactiveDim }, targetActive ? '▶ ' : '  '),
          Box({ width: 8 }, Text({ color: targetActive ? 'primary' : inactiveColor, dim: !targetActive && inactiveDim }, 'Target:')),
          Text({ color: !toShared ? 'info' : inactiveColor, bold: !toShared, dim: toShared && inactiveDim }, !toShared ? '● ' : '○ '),
          Text({ color: !toShared ? 'info' : inactiveColor, dim: toShared && inactiveDim }, svcDisplay),
          Text({ color: inactiveColor, dim: inactiveDim }, '  '),
          Text({ color: toShared ? 'accent' : inactiveColor, bold: toShared, dim: !toShared && inactiveDim }, toShared ? '● ' : '○ '),
          Text({ color: toShared ? 'accent' : inactiveColor, dim: !toShared && inactiveDim }, 'SHARED')
        )
      )
    }

    // Environment selector
    modalContent.push(
      Box(
        { flexDirection: 'row', alignItems: 'center' },
        Text({ color: envActive ? 'primary' : inactiveColor, bold: envActive, dim: !envActive && inactiveDim }, envActive ? '▶ ' : '  '),
        Box({ width: 8 }, Text({ color: envActive ? 'primary' : inactiveColor, dim: !envActive && inactiveDim }, 'Env:')),
        ...envList.map((env, idx) => {
          const selected = idx === targetEnvIdx
          const color = selected ? getEnvColor(env) : inactiveColor
          return Text(
            { color, bold: selected, dim: !selected && inactiveDim },
            (selected ? '●' : '○') + env.toUpperCase().substring(0, 3) + ' '
          )
        })
      )
    )

    modalContent.push(Box({ height: 1 }))

    // Action buttons
    modalContent.push(
      Box(
        { flexDirection: 'row', gap: 3, justifyContent: 'center' },
        Box({ flexDirection: 'row' }, Text({ color: 'success', bold: true, inverse: true }, ' Enter '), Text({ color: 'foreground' }, ' Save')),
        Box({ flexDirection: 'row' }, Text({ color: 'error', bold: true, inverse: true }, ' Esc '), Text({ color: 'foreground' }, ' Cancel'))
      )
    )

  } else if (action === 'edit') {
    modalContent.push(
      Box({ flexDirection: 'row', gap: 1 },
        Text({ color: 'foreground', bold: true }, 'Current: '),
        Text({ color: 'muted' }, secret ? maskValue(secret.value, true).substring(0, 35) : '(empty)')
      )
    )
    modalContent.push(Box({ height: 1 }))
    modalContent.push(
      Box({ flexDirection: 'row', gap: 1 },
        Text({ color: 'foreground', bold: true }, 'New:     '),
        Box({ minWidth: 35, borderStyle: 'single', borderColor: 'primary', paddingX: 1 },
          Text({ color: 'primary', bold: true }, value.length > 30 ? value.substring(0, 27) + '...' : (value || ' ')),
          Text({ color: 'warning' }, '▌')
        )
      )
    )
    modalContent.push(Box({ height: 1 }))
    modalContent.push(
      Box({ flexDirection: 'row', gap: 2 },
        Text({ color: 'foreground' }, 'Type new value, then'),
        Text({ color: 'success', bold: true }, 'Enter'),
        Text({ color: 'foreground' }, 'to save')
      )
    )

  } else if (action === 'promote') {
    modalContent.push(
      Box({ flexDirection: 'column', gap: 1 },
        Text({ color: 'foreground', bold: true }, `Move "${secret?.key}" from service to shared?`),
        Box({ height: 1 }),
        Text({ color: 'info' }, 'This will make it available to ALL services.')
      )
    )
    modalContent.push(Box({ height: 1 }))
    modalContent.push(
      Box({ flexDirection: 'row', gap: 2 },
        Text({ color: 'success', bold: true }, 'Enter'),
        Text({ color: 'foreground' }, 'confirm'),
        Text({ color: 'error', bold: true }, 'Esc'),
        Text({ color: 'foreground' }, 'cancel')
      )
    )

  } else if (action === 'spread') {
    const svcCount = services().filter(s => s.name !== '[SHARED]').length
    modalContent.push(
      Box({ flexDirection: 'column', gap: 1 },
        Text({ color: 'foreground', bold: true }, `Copy "${secret?.key}" to all ${svcCount} services?`),
        Box({ height: 1 }),
        Text({ color: 'warning' }, 'This will override any service-specific values.')
      )
    )
    modalContent.push(Box({ height: 1 }))
    modalContent.push(
      Box({ flexDirection: 'row', gap: 2 },
        Text({ color: 'success', bold: true }, 'Enter'),
        Text({ color: 'foreground' }, 'confirm'),
        Text({ color: 'error', bold: true }, 'Esc'),
        Text({ color: 'foreground' }, 'cancel')
      )
    )

  } else if (action === 'delete') {
    modalContent.push(
      Box({ flexDirection: 'column', gap: 1 },
        Text({ color: 'foreground' }, 'Delete this variable?'),
        Box({ height: 1 }),
        Box({ flexDirection: 'row', gap: 1 },
          Text({ color: 'foreground', bold: true }, 'Key:   '),
          Text({ color: 'error' }, secret?.key)
        ),
        Box({ flexDirection: 'row', gap: 1 },
          Text({ color: 'foreground', bold: true }, 'Value: '),
          Text({ color: 'muted' }, secret ? maskValue(secret.value, true).substring(0, 35) : '(empty)')
        )
      )
    )
    modalContent.push(Box({ height: 1 }))
    modalContent.push(
      Box({ flexDirection: 'row', gap: 2 },
        Text({ color: 'error', bold: true }, 'Enter'),
        Text({ color: 'foreground' }, 'delete'),
        Text({ color: 'success', bold: true }, 'Esc'),
        Text({ color: 'foreground' }, 'cancel')
      )
    )

  } else if (action === 'copy' || action === 'move') {
    const currentEnv = environments()[selectedEnvIdx()]
    const isMonorepoMode = isMonorepo()
    const svcList = services()
    const targetSvcIdx = targetServiceIdx()
    const targetSvc = svcList[targetSvcIdx]

    // From: env + service
    modalContent.push(
      Box({ flexDirection: 'row', gap: 1 },
        Text({ color: 'foreground', bold: true }, 'From: '),
        Text({ color: getEnvColor(currentEnv) }, currentEnv.toUpperCase()),
        isMonorepoMode ? Text({ color: 'muted' }, ' / ') : null,
        isMonorepoMode ? Text({ color: 'info' }, currentService?.name || '') : null
      )
    )

    // To: env selector
    if (targetEnv) {
      modalContent.push(
        Box({ flexDirection: 'row', gap: 1 },
          Text({ color: 'foreground', bold: true }, 'To:   '),
          Text({ color: getEnvColor(targetEnv), bold: true }, targetEnv.toUpperCase()),
          isMonorepoMode && targetSvc ? Text({ color: 'muted' }, ' / ') : null,
          isMonorepoMode && targetSvc ? Text({ color: 'warning', bold: true }, targetSvc.name) : null
        )
      )
    }

    modalContent.push(Box({ height: 1 }))

    // Environment selector
    modalContent.push(
      Box({ flexDirection: 'row', gap: 1 },
        Text({ color: 'foreground' }, 'Env:  '),
        ...envList.map((env, idx) => {
          const selected = idx === targetIdx
          const color = selected ? getEnvColor(env) : 'muted'
          return Text(
            { color, bold: selected, dim: !selected },
            (selected ? '●' : '○') + env.toUpperCase().substring(0, 3) + ' '
          )
        }),
        Text({ color: 'info', dim: true }, '← →')
      )
    )

    // Service selector (monorepo only)
    if (isMonorepoMode && svcList.length > 0) {
      modalContent.push(
        Box({ flexDirection: 'row', gap: 1 },
          Text({ color: 'foreground' }, 'Svc:  '),
          ...svcList.map((svc, idx) => {
            const selected = idx === targetSvcIdx
            const displayName = svc.name.length > 8 ? svc.name.substring(0, 7) + '…' : svc.name
            return Text(
              { color: selected ? 'warning' : 'muted', bold: selected, dim: !selected },
              (selected ? '●' : '○') + displayName + ' '
            )
          }),
          Text({ color: 'info', dim: true }, '↑ ↓')
        )
      )
    }

    modalContent.push(Box({ height: 1 }))
    modalContent.push(
      Box({ flexDirection: 'row', gap: 1 },
        Text({ color: 'foreground', bold: true }, 'Value: '),
        Text({ color: 'primary' }, secret ? maskValue(secret.value, true).substring(0, 35) : '(empty)')
      )
    )
    modalContent.push(Box({ height: 1 }))
    modalContent.push(
      Box({ flexDirection: 'row', gap: 2 },
        Text({ color: 'success', bold: true }, 'Enter'),
        Text({ color: 'foreground' }, 'confirm'),
        Text({ color: 'error', bold: true }, 'Esc'),
        Text({ color: 'foreground' }, 'cancel')
      )
    )

  } else if (action === 'deleteAll') {
    const serviceVars = secrets().filter(v => v.source === 'service' || v.source === 'override')
    const svcName = currentService?.name || 'service'
    modalContent.push(
      Box({ flexDirection: 'column', gap: 1 },
        Text({ color: 'error', bold: true }, `Delete ALL ${serviceVars.length} service-specific vars?`),
        Box({ height: 1 }),
        Text({ color: 'foreground' }, `Service: ${svcName}`),
        Text({ color: 'warning' }, 'Only shared vars will remain.')
      )
    )
    modalContent.push(Box({ height: 1 }))
    modalContent.push(
      Box({ flexDirection: 'row', gap: 2 },
        Text({ color: 'error', bold: true }, 'Enter'),
        Text({ color: 'foreground' }, 'delete all'),
        Text({ color: 'success', bold: true }, 'Esc'),
        Text({ color: 'foreground' }, 'cancel')
      )
    )

  } else if (action === 'moveToService') {
    const svcList = services()
    const targetSvc = svcList[targetServiceIdx()]
    const targetName = targetSvc?.name || '???'
    modalContent.push(
      Box({ flexDirection: 'column', gap: 1 },
        Text({ color: 'foreground', bold: true }, `Move "${secret?.key}" to another service?`),
        Box({ height: 1 }),
        Box({ flexDirection: 'row', gap: 1 },
          Text({ color: 'foreground' }, 'From:'),
          Text({ color: 'info' }, currentService?.name || 'current')
        ),
        Box({ flexDirection: 'row', gap: 1 },
          Text({ color: 'foreground' }, 'To:  '),
          Text({ color: 'warning', bold: true }, targetName),
          Text({ color: 'info' }, ' (use ← → to change)')
        )
      )
    )
    modalContent.push(Box({ height: 1 }))
    // Show available services
    modalContent.push(
      Box({ flexDirection: 'row', gap: 1 },
        ...svcList.map((svc, idx) => {
          if (idx === selectedServiceIdx()) return null // Skip current
          const isTarget = idx === targetServiceIdx()
          const displayName = svc.name.length > 10 ? svc.name.substring(0, 9) + '…' : svc.name
          return Text(
            { color: isTarget ? 'warning' : 'muted', bold: isTarget, dim: !isTarget },
            (isTarget ? '●' : '○') + displayName + ' '
          )
        }).filter(Boolean)
      )
    )
    modalContent.push(Box({ height: 1 }))
    modalContent.push(
      Box({ flexDirection: 'row', gap: 2 },
        Text({ color: 'success', bold: true }, 'Enter'),
        Text({ color: 'foreground' }, 'move'),
        Text({ color: 'error', bold: true }, 'Esc'),
        Text({ color: 'foreground' }, 'cancel')
      )
    )
  }

  // Status message
  if (message) {
    modalContent.push(Box({ height: 1 }))
    modalContent.push(Text({ color: 'success' }, `✓ ${message}`))
  } else if (err) {
    modalContent.push(Box({ height: 1 }))
    modalContent.push(Text({ color: 'error' }, `✗ ${err}`))
  } else if (isLoading) {
    modalContent.push(Box({ height: 1 }))
    modalContent.push(Text({ color: 'primary' }, '● Processing...'))
  }

  return Box(
    { flexDirection: 'column', height: '100%' },
    Box({ flexGrow: 1 }),
    Box(
      { flexDirection: 'row' },
      Box({ flexGrow: 1 }),
      Box(
        { flexDirection: 'column', borderStyle: 'single', borderColor: ACTION_COLORS[action], padding: 2, minWidth: 50 },
        ...modalContent
      ),
      Box({ flexGrow: 1 })
    ),
    Box({ flexGrow: 1 })
  )
}
