/**
 * Secrets Explorer Main Component
 *
 * The main TUI component with all hotkey handlers and navigation logic.
 */

import {
  Box,
  batch,
  useHotkeys,
  useInput,
  useApp,
  AppShell,
  Text,
} from 'tuiuiu.js'
import { getProjectName } from '../../../lib/config-loader.js'

import type { SecretsExplorerProps } from './types.js'
import {
  loadedConfig,
  isMonorepo,
  splashVisible,
  services,
  selectedServiceIdx, setSelectedServiceIdx,
  environments,
  selectedEnvIdx, setSelectedEnvIdx,
  secrets,
  setShowValues,
  selectedSecretIdx, setSelectedSecretIdx,
  focusArea, setFocusArea,
  searchFilter, setSearchFilter,
  isSearching, setIsSearching,
  scrollOffset, setScrollOffset,
  visibleRows,
  actionType, setActionType,
  actionTargetEnvIdx, setActionTargetEnvIdx,
  setActionMessage,
  setActionError,
  actionLoading, setActionLoading,
  inputKey, setInputKey,
  inputValue, setInputValue,
  inputSensitive, setInputSensitive,
  inputTargetShared, setInputTargetShared,
  inputTargetEnvIdx, setInputTargetEnvIdx,
  targetServiceIdx, setTargetServiceIdx,
  setModalFieldIdx,
  getModalField,
  MODAL_FIELDS,
  resetActionState,
} from './store.js'
import { getEnvColor } from './utils.js'
import { applySecretsFromStore, reloadEnvironment } from './loader.js'
import {
  performDelete,
  performCopy,
  performMove,
  performPromote,
  performSpread,
  performAdd,
  performEdit,
  performDeleteAllServiceVars,
  performMoveToService,
} from './actions.js'
import { SplashScreen, Header, ServiceList, SecretsTable, StatusFooter } from './components.js'
import { ActionModal } from './modal.js'

// ============================================================================
// Environment Tabs Component
// ============================================================================

function EnvTabs() {
  const envList = environments()
  const selectedIdx = selectedEnvIdx()

  return Box(
    { flexDirection: 'row', gap: 1, paddingX: 1 },
    ...envList.map((env, idx) => {
      const isSelected = idx === selectedIdx
      const color = getEnvColor(env)
      return Box(
        {
          onClick: () => {
            setSelectedEnvIdx(idx)
            if (loadedConfig()) {
              const service = services()[selectedServiceIdx()]
              applySecretsFromStore(env, service)
            }
          },
        },
        Text(
          {
            color: isSelected ? color : 'foreground',
            bold: isSelected,
            dim: !isSelected,
            inverse: isSelected,
          },
          ` ${(idx + 1)} ${env.toUpperCase()} `
        )
      )
    })
  )
}

// ============================================================================
// Main Component with Hotkeys
// ============================================================================

export function SecretsExplorer(props: SecretsExplorerProps) {
  const { exit } = useApp()

  // ALL HOOKS MUST BE CALLED UNCONDITIONALLY (before any returns)

  // Keyboard handlers
  useHotkeys('q', () => exit())

  // Toggle values visibility
  useHotkeys('v', () => {
    if (splashVisible() || isSearching()) return
    setShowValues(v => !v)
  })

  // Refresh
  useHotkeys('r', () => {
    if (splashVisible() || !loadedConfig() || isSearching()) return
    const service = services()[selectedServiceIdx()]
    const env = environments()[selectedEnvIdx()]
    if (env) {
      applySecretsFromStore(env, service)
    }
  })

  // Shift+Tab to cycle backwards through environments
  useHotkeys('shift+tab', () => {
    if (splashVisible()) return
    const envList = environments()
    const currentIdx = selectedEnvIdx()
    const nextIdx = (currentIdx - 1 + envList.length) % envList.length
    setSelectedEnvIdx(nextIdx)
    if (loadedConfig()) {
      const service = services()[selectedServiceIdx()]
      applySecretsFromStore(envList[nextIdx], service)
    }
  })

  // ========== CONTEXT-AWARE NAVIGATION ==========

  const navigateSecretsUp = () => {
    const newIdx = Math.max(0, selectedSecretIdx() - 1)
    setSelectedSecretIdx(newIdx)
    if (newIdx < scrollOffset()) {
      setScrollOffset(newIdx)
    }
  }

  const navigateSecretsDown = () => {
    const filter = searchFilter()
    const allSecrets = secrets()
    const filteredSecrets = filter
      ? allSecrets.filter(s => s.key.toLowerCase().includes(filter.toLowerCase()))
      : allSecrets
    const maxIdx = filteredSecrets.length - 1
    const newIdx = Math.min(maxIdx, selectedSecretIdx() + 1)
    setSelectedSecretIdx(newIdx)
    if (newIdx >= scrollOffset() + visibleRows()) {
      setScrollOffset(newIdx - visibleRows() + 1)
    }
  }

  const navigateServicesUp = () => {
    const currentIdx = selectedServiceIdx()
    const newIdx = Math.max(0, currentIdx - 1)
    if (newIdx !== currentIdx) {
      setSelectedServiceIdx(newIdx)
      if (loadedConfig()) {
        const service = services()[newIdx]
        const env = environments()[selectedEnvIdx()]
        if (env) applySecretsFromStore(env, service)
      }
    }
  }

  const navigateServicesDown = () => {
    const currentIdx = selectedServiceIdx()
    const newIdx = Math.min(services().length - 1, currentIdx + 1)
    if (newIdx !== currentIdx) {
      setSelectedServiceIdx(newIdx)
      if (loadedConfig()) {
        const service = services()[newIdx]
        const env = environments()[selectedEnvIdx()]
        if (env) applySecretsFromStore(env, service)
      }
    }
  }

  const navigateModalUp = () => {
    const action = actionType()
    if (action === 'add') {
      const currentService = services()[selectedServiceIdx()]
      const hasTarget = currentService?.name !== '[SHARED]'
      const currentIdx = getModalField() === 'key' ? 0 : getModalField() === 'value' ? 1 : getModalField() === 'type' ? 2 : getModalField() === 'target' ? 3 : 4
      let newIdx = Math.max(0, currentIdx - 1)
      if (!hasTarget && MODAL_FIELDS[newIdx] === 'target') {
        newIdx = Math.max(0, newIdx - 1)
      }
      setModalFieldIdx(newIdx)
    }
  }

  const navigateModalDown = () => {
    const action = actionType()
    if (action === 'add') {
      const currentService = services()[selectedServiceIdx()]
      const hasTarget = currentService?.name !== '[SHARED]'
      const maxIdx = hasTarget ? 4 : 3
      const currentIdx = getModalField() === 'key' ? 0 : getModalField() === 'value' ? 1 : getModalField() === 'type' ? 2 : getModalField() === 'target' ? 3 : 4
      let newIdx = Math.min(maxIdx, currentIdx + 1)
      if (!hasTarget && MODAL_FIELDS[newIdx] === 'target') {
        newIdx = Math.min(maxIdx, newIdx + 1)
      }
      setModalFieldIdx(newIdx)
    }
  }

  // Up arrow
  useHotkeys('up', () => {
    if (splashVisible()) return
    const action = actionType()
    if (action === 'add') {
      navigateModalUp()
      return
    }
    // In copy/move mode (monorepo): up/down changes target service
    if ((action === 'copy' || action === 'move') && isMonorepo()) {
      const svcList = services()
      const currentIdx = targetServiceIdx()
      const newIdx = (currentIdx - 1 + svcList.length) % svcList.length
      setTargetServiceIdx(newIdx)
      return
    }
    if (focusArea() === 'secrets') {
      navigateSecretsUp()
      return
    }
    if (focusArea() === 'services') {
      navigateServicesUp()
      return
    }
  })

  // Down arrow
  useHotkeys('down', () => {
    if (splashVisible()) return
    const action = actionType()
    if (action === 'add') {
      navigateModalDown()
      return
    }
    // In copy/move mode (monorepo): up/down changes target service
    if ((action === 'copy' || action === 'move') && isMonorepo()) {
      const svcList = services()
      const currentIdx = targetServiceIdx()
      const newIdx = (currentIdx + 1) % svcList.length
      setTargetServiceIdx(newIdx)
      return
    }
    if (focusArea() === 'secrets') {
      navigateSecretsDown()
      return
    }
    if (focusArea() === 'services') {
      navigateServicesDown()
      return
    }
  })

  // J/K for vim-style navigation
  useHotkeys('j', () => {
    if (splashVisible() || isSearching() || actionType()) return
    navigateSecretsDown()
  })

  useHotkeys('k', () => {
    if (splashVisible() || isSearching() || actionType()) return
    navigateSecretsUp()
  })

  // Page down/up
  useHotkeys('pagedown', () => {
    if (splashVisible()) return
    const filter = searchFilter()
    const allSecrets = secrets()
    const filteredSecrets = filter
      ? allSecrets.filter(s => s.key.toLowerCase().includes(filter.toLowerCase()))
      : allSecrets
    const maxIdx = filteredSecrets.length - 1
    const newIdx = Math.min(maxIdx, selectedSecretIdx() + visibleRows())
    setSelectedSecretIdx(newIdx)
    setScrollOffset(Math.min(filteredSecrets.length - visibleRows(), scrollOffset() + visibleRows()))
  })

  useHotkeys('pageup', () => {
    if (splashVisible()) return
    const newIdx = Math.max(0, selectedSecretIdx() - visibleRows())
    setSelectedSecretIdx(newIdx)
    setScrollOffset(Math.max(0, scrollOffset() - visibleRows()))
  })

  // Number keys 1-5 to directly select environment
  const selectEnvByIndex = (idx: number) => {
    if (splashVisible()) return
    const envList = environments()
    if (idx < envList.length) {
      const currentIdx = selectedEnvIdx()
      if (idx !== currentIdx) {
        setSelectedEnvIdx(idx)
        if (loadedConfig()) {
          const service = services()[selectedServiceIdx()]
          applySecretsFromStore(envList[idx], service)
        }
      }
    }
  }

  // Text input handler
  useInput((input, key) => {
    if (splashVisible()) return false

    const action = actionType()
    const searching = isSearching()

    if (!searching && !action) {
      if (input >= '1' && input <= '5') {
        const envIdx = parseInt(input) - 1
        selectEnvByIndex(envIdx)
        return true
      }
      return false
    }

    if (input && input.length >= 1 && !key.ctrl && !key.meta) {
      const printable = input.replace(/[\x00-\x1F\x7F]/g, '')
      if (!printable) return false

      if (searching) {
        setSearchFilter(f => f + printable)
        return true
      }

      if (action === 'add') {
        const field = getModalField()
        if (field === 'key') {
          const cleaned = printable.toUpperCase().replace(/[^A-Z0-9_]/g, '')
          setInputKey(k => k + cleaned)
          return true
        } else if (field === 'value') {
          setInputValue(v => v + printable)
          return true
        }
        return false
      }

      if (action === 'edit') {
        setInputValue(v => v + printable)
        return true
      }
    }

    return false
  })

  // Search mode toggle
  useHotkeys('/', () => {
    if (splashVisible()) return
    if (actionType()) return
    if (!isSearching()) {
      setIsSearching(true)
    }
  })

  // ========== ACTION HOTKEYS ==========

  useHotkeys('d', () => {
    if (splashVisible() || actionType() || isSearching()) return
    if (secrets().length === 0) return
    batch(() => {
      setActionType('delete')
      setActionMessage(null)
      setActionError(null)
      setActionLoading(false)
    })
  })

  useHotkeys('c', () => {
    if (splashVisible() || actionType() || isSearching()) return
    if (secrets().length === 0) return
    const currentIdx = selectedEnvIdx()
    const nextIdx = (currentIdx + 1) % environments().length
    batch(() => {
      setActionType('copy')
      setActionTargetEnvIdx(nextIdx)
      // Initialize target service to current service
      setTargetServiceIdx(selectedServiceIdx())
      setActionMessage(null)
      setActionError(null)
      setActionLoading(false)
    })
  })

  useHotkeys('m', () => {
    if (splashVisible() || actionType() || isSearching()) return
    if (secrets().length === 0) return
    const currentIdx = selectedEnvIdx()
    const nextIdx = (currentIdx + 1) % environments().length
    batch(() => {
      setActionType('move')
      setActionTargetEnvIdx(nextIdx)
      // Initialize target service to current service
      setTargetServiceIdx(selectedServiceIdx())
      setActionMessage(null)
      setActionError(null)
      setActionLoading(false)
    })
  })

  useHotkeys('p', () => {
    if (splashVisible() || actionType() || isSearching()) return
    if (!isMonorepo()) return
    if (secrets().length === 0) return
    const secret = secrets()[selectedSecretIdx()]
    if (secret.source === 'shared') return
    batch(() => {
      setActionType('promote')
      setActionMessage(null)
      setActionError(null)
      setActionLoading(false)
    })
  })

  useHotkeys('shift+s', () => {
    if (splashVisible() || actionType() || isSearching()) return
    if (!isMonorepo()) return
    if (secrets().length === 0) return
    const secret = secrets()[selectedSecretIdx()]
    if (secret.source !== 'shared') return
    batch(() => {
      setActionType('spread')
      setActionMessage(null)
      setActionError(null)
      setActionLoading(false)
    })
  })

  // Shift+D: Delete ALL service-specific vars (reset to shared only)
  useHotkeys('shift+d', () => {
    if (splashVisible() || actionType() || isSearching()) return
    if (!isMonorepo()) return
    const service = services()[selectedServiceIdx()]
    if (!service || service.name === '[SHARED]') return
    // Count service-specific vars
    const serviceVars = secrets().filter(v => v.source === 'service' || v.source === 'override')
    if (serviceVars.length === 0) return
    batch(() => {
      setActionType('deleteAll')
      setActionMessage(null)
      setActionError(null)
      setActionLoading(false)
    })
  })

  // Shift+M: Move var to another service
  useHotkeys('shift+m', () => {
    if (splashVisible() || actionType() || isSearching()) return
    if (!isMonorepo()) return
    if (secrets().length === 0) return
    const secret = secrets()[selectedSecretIdx()]
    // Can only move service-specific or override vars
    if (secret.source === 'shared') return
    batch(() => {
      setActionType('moveToService')
      // Start with first service that's not current
      const currentIdx = selectedServiceIdx()
      const nextIdx = currentIdx === 0 ? 1 : 0
      setTargetServiceIdx(nextIdx)
      setActionMessage(null)
      setActionError(null)
      setActionLoading(false)
    })
  })

  useHotkeys('a', () => {
    if (splashVisible() || actionType() || isSearching()) return
    batch(() => {
      setActionType('add')
      setInputKey('')
      setInputValue('')
      setInputSensitive(false)
      setInputTargetShared(services()[selectedServiceIdx()]?.name === '[SHARED]')
      setInputTargetEnvIdx(selectedEnvIdx())
      setModalFieldIdx(0)
      setActionMessage(null)
      setActionError(null)
      setActionLoading(false)
    })
  })

  useHotkeys('e', () => {
    if (splashVisible() || actionType() || isSearching()) return
    if (secrets().length === 0) return
    const secret = secrets()[selectedSecretIdx()]
    batch(() => {
      setActionType('edit')
      setInputValue(secret.value)
      setActionMessage(null)
      setActionError(null)
      setActionLoading(false)
    })
  })

  useHotkeys('t', () => {
    if (actionType() !== 'add') return
    setInputSensitive(s => !s)
  })

  useHotkeys('shift+t', () => {
    if (actionType() !== 'add') return
    if (services()[selectedServiceIdx()]?.name === '[SHARED]') return
    setInputTargetShared(s => !s)
  })

  useHotkeys('escape', () => {
    if (isSearching()) {
      setIsSearching(false)
      return
    }
    if (searchFilter()) {
      batch(() => {
        setSearchFilter('')
        setScrollOffset(0)
        setSelectedSecretIdx(0)
      })
      return
    }
    if (actionType()) {
      resetActionState()
      return
    }
    if (focusArea() === 'secrets' && isMonorepo()) {
      setFocusArea('services')
      return
    }
    exit()
  })

  useHotkeys('backspace', () => {
    if (isSearching()) {
      setSearchFilter(f => f.slice(0, -1))
      return
    }
    const action = actionType()
    if (action === 'add') {
      const field = getModalField()
      if (field === 'key') {
        setInputKey(k => k.slice(0, -1))
      } else if (field === 'value') {
        setInputValue(v => v.slice(0, -1))
      }
    } else if (action === 'edit') {
      setInputValue(v => v.slice(0, -1))
    }
  })

  useHotkeys('tab', () => {
    if (splashVisible()) return
    const action = actionType()
    if (action === 'add') {
      navigateModalDown()
      return
    }
    const envList = environments()
    const currentIdx = selectedEnvIdx()
    const nextIdx = (currentIdx + 1) % envList.length
    setSelectedEnvIdx(nextIdx)
    if (loadedConfig()) {
      const service = services()[selectedServiceIdx()]
      applySecretsFromStore(envList[nextIdx], service)
    }
  })

  useHotkeys('return', async () => {
    if (isSearching()) {
      setIsSearching(false)
      return
    }

    const action = actionType()

    if (!action && focusArea() === 'services' && isMonorepo()) {
      setFocusArea('secrets')
      return
    }

    if (!action || actionLoading()) return

    const secret = secrets()[selectedSecretIdx()]
    if (action !== 'add' && !secret) return

    setActionLoading(true)
    setActionError(null)
    setActionMessage(null)

    let result: { success: boolean; error?: string; count?: number }

    if (action === 'delete') {
      result = await performDelete(secret)
    } else if (action === 'copy') {
      const targetEnv = environments()[actionTargetEnvIdx()]
      const targetSvc = isMonorepo() ? services()[targetServiceIdx()] : undefined
      result = await performCopy(secret, targetEnv, targetSvc?.name, targetSvc?.path)
    } else if (action === 'move') {
      const targetEnv = environments()[actionTargetEnvIdx()]
      const targetSvc = isMonorepo() ? services()[targetServiceIdx()] : undefined
      result = await performMove(secret, targetEnv, targetSvc?.name, targetSvc?.path)
    } else if (action === 'promote') {
      result = await performPromote(secret)
    } else if (action === 'spread') {
      result = await performSpread(secret)
    } else if (action === 'add') {
      const key = inputKey().trim()
      const value = inputValue()
      const sensitive = inputSensitive()
      const toShared = inputTargetShared()
      const targetEnv = environments()[inputTargetEnvIdx()]

      if (!key) {
        setActionError('Key cannot be empty')
        setActionLoading(false)
        return
      }

      result = await performAdd(key, value, sensitive, toShared, targetEnv)
    } else if (action === 'edit') {
      const newValue = inputValue()
      result = await performEdit(secret, newValue)
    } else if (action === 'deleteAll') {
      const serviceVars = secrets()
      result = await performDeleteAllServiceVars(serviceVars)
    } else if (action === 'moveToService') {
      const targetSvc = services()[targetServiceIdx()]
      if (!targetSvc) {
        result = { success: false, error: 'No target service selected' }
      } else {
        result = await performMoveToService(secret, targetSvc.name, targetSvc.path)
      }
    } else {
      result = { success: false, error: 'Unknown action' }
    }

    if (result.success) {
      let msg = 'Done!'
      if (action === 'delete') msg = 'Deleted!'
      else if (action === 'copy') msg = 'Copied!'
      else if (action === 'move') msg = 'Moved!'
      else if (action === 'promote') msg = 'Promoted to shared!'
      else if (action === 'spread') msg = `Spread to ${result.count || 'all'} services!`
      else if (action === 'add') msg = 'Variable added!'
      else if (action === 'edit') msg = 'Value updated!'
      else if (action === 'deleteAll') msg = `Deleted ${result.count || 'all'} service vars!`
      else if (action === 'moveToService') msg = 'Moved to service!'

      setActionMessage(msg)

      const refreshEnvIdx = action === 'add' ? inputTargetEnvIdx() : selectedEnvIdx()

      setTimeout(async () => {
        const freshService = services()[selectedServiceIdx()]
        const freshEnvList = environments()
        const freshEnv = freshEnvList[refreshEnvIdx] || freshEnvList[0]

        batch(() => {
          setActionType(null)
          setActionMessage(null)
          setActionLoading(false)
          setInputKey('')
          setInputValue('')
          setInputSensitive(false)
          setInputTargetShared(false)
          if (action === 'add' && refreshEnvIdx !== selectedEnvIdx()) {
            setSelectedEnvIdx(refreshEnvIdx)
          }
        })

        // Reload environment to refresh cache after modification
        if (freshEnv !== 'local') {
          await reloadEnvironment(freshEnv)
        }
        applySecretsFromStore(freshEnv, freshService)
      }, 800)
    } else {
      setActionError(result.error || 'Unknown error')
      setActionLoading(false)
    }
  })

  // Left/Right arrows
  const originalLeft = () => {
    if (splashVisible()) return
    const envList = environments()
    const currentIdx = selectedEnvIdx()
    const newIdx = (currentIdx - 1 + envList.length) % envList.length
    setSelectedEnvIdx(newIdx)
    if (loadedConfig()) {
      const service = services()[selectedServiceIdx()]
      applySecretsFromStore(envList[newIdx], service)
    }
  }

  const originalRight = () => {
    if (splashVisible()) return
    const envList = environments()
    const currentIdx = selectedEnvIdx()
    const newIdx = (currentIdx + 1) % envList.length
    setSelectedEnvIdx(newIdx)
    if (loadedConfig()) {
      const service = services()[selectedServiceIdx()]
      applySecretsFromStore(envList[newIdx], service)
    }
  }

  useHotkeys('left', () => {
    const action = actionType()
    if (action && action !== 'delete' && action !== 'deleteAll') {
      if (action === 'add') {
        const field = getModalField()
        if (field === 'type') {
          setInputSensitive(s => !s)
        } else if (field === 'target') {
          if (services()[selectedServiceIdx()]?.name !== '[SHARED]') {
            setInputTargetShared(s => !s)
          }
        } else if (field === 'env') {
          const envList = environments()
          const currentIdx = inputTargetEnvIdx()
          const newIdx = (currentIdx - 1 + envList.length) % envList.length
          setInputTargetEnvIdx(newIdx)
        }
      } else if (action === 'moveToService') {
        // Navigate between services
        const svcList = services()
        const currentIdx = targetServiceIdx()
        let newIdx = (currentIdx - 1 + svcList.length) % svcList.length
        // Skip current service
        if (newIdx === selectedServiceIdx()) {
          newIdx = (newIdx - 1 + svcList.length) % svcList.length
        }
        setTargetServiceIdx(newIdx)
      } else {
        const envList = environments()
        const currentIdx = actionTargetEnvIdx()
        const newIdx = (currentIdx - 1 + envList.length) % envList.length
        setActionTargetEnvIdx(newIdx)
      }
      return
    }
    originalLeft()
  })

  useHotkeys('right', () => {
    const action = actionType()
    if (action && action !== 'delete' && action !== 'deleteAll') {
      if (action === 'add') {
        const field = getModalField()
        if (field === 'type') {
          setInputSensitive(s => !s)
        } else if (field === 'target') {
          if (services()[selectedServiceIdx()]?.name !== '[SHARED]') {
            setInputTargetShared(s => !s)
          }
        } else if (field === 'env') {
          const envList = environments()
          const currentIdx = inputTargetEnvIdx()
          const newIdx = (currentIdx + 1) % envList.length
          setInputTargetEnvIdx(newIdx)
        }
      } else if (action === 'moveToService') {
        // Navigate between services
        const svcList = services()
        const currentIdx = targetServiceIdx()
        let newIdx = (currentIdx + 1) % svcList.length
        // Skip current service
        if (newIdx === selectedServiceIdx()) {
          newIdx = (newIdx + 1) % svcList.length
        }
        setTargetServiceIdx(newIdx)
      } else {
        const envList = environments()
        const currentIdx = actionTargetEnvIdx()
        const newIdx = (currentIdx + 1) % envList.length
        setActionTargetEnvIdx(newIdx)
      }
      return
    }
    originalRight()
  })

  // Show splash screen while loading
  if (splashVisible() || !props.config) {
    return SplashScreen()
  }

  const project = getProjectName(props.config)
  const action = actionType()

  const sidebar = props.isMonorepo ? ServiceList() : undefined

  const content = action
    ? ActionModal() ?? Box({})
    : Box(
        { flexDirection: 'column', width: '100%', height: '100%' },
        Box({ paddingY: 1 }, EnvTabs()),
        SecretsTable()
      )

  return AppShell({
    header: Header({ project }),
    headerHeight: 1,
    sidebar: sidebar,
    sidebarWidth: props.isMonorepo ? 26 : 0,
    footer: StatusFooter(),
    footerHeight: 1,
    dividers: true,
    dividerStyle: 'line',
    dividerColor: 'border',
    padding: 0,
    children: content,
  })
}
