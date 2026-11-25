import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/i18n'
import { TodoPanelBody } from './todo-bar'

it('switches the same checklist between list and board without clearing selection', async () => {
  await i18n.changeLanguage('en')
  const user = userEvent.setup()
  const { container } = render(
    <TodoPanelBody
      todos={{ title: 'Work', todos: [{ content: 'Read source', active_form: 'Reading source', status: 'pending' }] }}
    />,
  )
  const list = screen.getByRole('radio', { name: i18n.t('chat.todo.viewList') })
  const board = screen.getByRole('radio', { name: i18n.t('chat.todo.viewBoard') })
  expect(screen.getByRole('radiogroup')).toHaveAccessibleName()
  expect(list).toHaveAttribute('aria-checked', 'true')
  expect(container.querySelector('[data-slot="todo-board-card-body"]')).toBeNull()
  await user.click(board)
  expect(board).toHaveAttribute('aria-checked', 'true')
  expect(container.querySelector('[data-slot="todo-board-card-body"]')).toHaveTextContent('Read source')
  await user.click(board)
  expect(board).toHaveAttribute('aria-checked', 'true')
  await user.click(list)
  expect(list).toHaveAttribute('aria-checked', 'true')
  expect(container.querySelector('[data-slot="todo-board-card-body"]')).toBeNull()
  expect(screen.getByText('Read source')).toBeInTheDocument()
})
