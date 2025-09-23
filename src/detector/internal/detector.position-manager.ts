import { Position, Symbol } from '@barfinex/types';

/**
 * Менеджер для управления позициями детектора
 */
export class DetectorPositionManager {
    private positions: Position[] = [];

    /** Получить все позиции */
    getAll(): Position[] {
        return this.positions;
    }

    /** Найти позицию по символу */
    findBySymbol(symbol: Symbol): Position | undefined {
        return this.positions.find((p) => p.symbol.name === symbol.name);
    }

    /** Добавить новую позицию */
    add(position: Position): void {
        const exists = this.findBySymbol(position.symbol);
        if (exists) {
            throw new Error(`Position for ${position.symbol.name} already exists`);
        }
        this.positions.push(position);
    }

    /** Удалить позицию */
    remove(position: Position): void {
        this.positions = this.positions.filter((p) => p !== position);
    }

    /** Обновить существующую позицию */
    update(position: Position): void {
        this.positions = this.positions.map((p) =>
            p.symbol.name === position.symbol.name ? position : p,
        );
    }

    /** Очистить все позиции */
    clear(): void {
        this.positions = [];
    }
}
