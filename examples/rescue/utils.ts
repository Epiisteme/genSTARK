// IMPORTS
// ================================================================================================
import { PrimeField } from '@guildofweavers/galois';

// RESCUE CLASS DEFINITION
// ================================================================================================
export class Rescue {

    readonly field      : PrimeField;
    readonly alpha      : bigint;
    readonly invAlpha   : bigint;
    readonly registers  : number;
    readonly rounds     : number;
    readonly mds        : bigint[][];
    readonly iConstants : bigint[];
    readonly cConstants : bigint[];
    readonly cMatrix    : bigint[][];

    // CONSTRUCTOR
    // --------------------------------------------------------------------------------------------
    constructor(field: PrimeField, alpha: bigint, invAlpha: bigint, registers: number, rounds: number, mds: bigint[][], constants: bigint[]) {
        this.field = field;
        this.alpha = alpha;
        this.invAlpha = invAlpha;
        this.registers = registers;
        this.rounds = rounds;
        this.mds = mds;

        const split = this.splitConstants(constants);
        this.iConstants = split.iConstants;
        this.cConstants = split.cConstants;
        this.cMatrix = split.constantMatrix;
    }

    // HASH FUNCTION
    // --------------------------------------------------------------------------------------------
    sponge(inputs: bigint[], unrolledKeys: bigint[][]) {

        const trace = new Array<bigint[]>();
    
        // copy inputs to state
        let state = new Array(this.registers).fill(0n);
        for (let i = 0; i < inputs.length; i++) {
            state[i] = inputs[i];
        }
        trace.push([...state]);
    
        // run through block cipher rounds
        state = this.vadd(state, unrolledKeys[0]);
        trace.push([...state]);
    
        for (let r = 0, k = 1; r < this.rounds; r++, k += 2) {
    
            // round r, step 1
            for (let i = 0; i < this.registers; i++) {
                state[i] = this.field.exp(state[i], this.invAlpha);
            }
            state = this.vadd(this.mmul(this.mds, state), unrolledKeys[k]);
            trace.push([...state]);
    
            // round r, step 2
            for (let i = 0; i < this.registers; i++) {
                state[i] = this.field.exp(state[i], this.alpha);
            }
            state = this.vadd(this.mmul(this.mds, state), unrolledKeys[k + 1]);
            trace.push([...state]);
        }
    
        // build and return output
        const output = new Array<bigint>(inputs.length);
        for (let i = 0; i < output.length; i++) {
            output[i] = state[i];
        }
    
        return { hash: output, trace };
    }

    modifiedSponge(inputs: bigint[], unrolledKeys: bigint[][]) {
        const trace = new Array<bigint[]>();
    
        // copy inputs to state
        let state = new Array(this.registers).fill(0n);
        for (let i = 0; i < inputs.length; i++) {
            state[i] = inputs[i];
        }
        trace.push([...state]);
        
        for (let r = 0, k = 2; r < this.rounds - 1; r++, k += 2) {
    
            // round r, step 1
            for (let i = 0; i < this.registers; i++) {
                state[i] = this.field.exp(state[i], this.alpha);
            }
            state = this.vadd(this.mmul(this.mds, state), unrolledKeys[k]);
            trace.push([...state]);

            // round r, step 2
            for (let i = 0; i < this.registers; i++) {
                state[i] = this.field.exp(state[i], this.invAlpha);
            }
            state = this.vadd(this.mmul(this.mds, state), unrolledKeys[k+1]);
            trace.push([...state]);
        }
    
        // build and return output
        const output = new Array<bigint>(inputs.length);
        for (let i = 0; i < output.length; i++) {
            output[i] = state[i];
        }
    
        return { hash: output, trace };
    }

    // CONSTANT PROCESSORS
    // --------------------------------------------------------------------------------------------
    unrollConstants() {

        const result = new Array<bigint[]>();

        // initial state
        let keyState = new Array<bigint>(this.registers).fill(0n);
        let keyInjection = this.iConstants;
        keyState = this.vadd(keyState, keyInjection);
        result.push([...keyState]);

        // record key state for each round
        for (let r = 0; r <= this.rounds; r++) {

            // round r, step 1
            for (let i = 0; i < this.registers; i++) {
                keyState[i] = this.field.exp(keyState[i], this.invAlpha);
            }
            keyInjection = this.vadd(this.mmul(this.cMatrix, keyInjection), this.cConstants);
            keyState = this.vadd(this.mmul(this.mds, keyState), keyInjection);
            result.push([...keyState]);

            // round r, step 2
            for (let i = 0; i < this.registers; i++) {
                keyState[i] = this.field.exp(keyState[i], this.alpha);
            }
            keyInjection = this.vadd(this.mmul(this.cMatrix, keyInjection), this.cConstants);
            keyState = this.vadd(this.mmul(this.mds, keyState), keyInjection);
            result.push([...keyState]);
        }

        return result;
    }

    groupConstants(constants: bigint[][]) {

        // first 2 elements from constant trace go into initial constants
        const initialConstants = [...constants[0], ...constants[1]];
    
        // all other elements go into round constants
        const roundConstants = new Array<bigint[]>(this.registers * 2);
        for (let i = 0; i < roundConstants.length; i++) {
            roundConstants[i] = new Array<bigint>(this.rounds);
        }
    
        for (let i = 0, k = 2; i < this.rounds; i++, k += 2) {
            for (let j = 0; j < this.registers; j++) {
                roundConstants[j][i] = constants[k][j];
                roundConstants[this.registers + j][i] = constants[k + 1][j];
            }
        }
    
        return { initialConstants, roundConstants };
    }

    // HELPER METHODS
    // --------------------------------------------------------------------------------------------
    private vadd(a: bigint[], b: bigint[]) {
        const result = [];
        for (let i = 0; i < a.length; i++) {
            result.push(this.field.add(a[i], b[i]));
        }
        return result;
    }

    private mmul(a: bigint[][], b: bigint[]) {
        const result = [];
        for (let i = 0; i < a.length; i++) {
            let s = 0n;
            for (let j = 0; j < a[i].length; j++) {
                s = this.field.add(s, this.field.mul(a[i][j], b[j]));
            }
            result.push(s);
        }
        return result;
    }

    private splitConstants(constants: bigint[]) {
        constants = constants.slice();

        const iConstants = new Array<bigint>();
        for (let i = 0; i < this.registers; i++) {
            iConstants.push(constants.shift()!);
        }

        const constantMatrix = new Array<bigint[]>();
        for (let i = 0; i < this.registers; i++) {
            let row = new Array<bigint>();
            for (let j = 0; j < this.registers; j++) {
                row.push(constants.shift()!);
            }
            constantMatrix.push(row);
        }

        const cConstants = new Array<bigint>()
        for (let i = 0; i < this.registers; i++) {
            cConstants.push(constants.shift()!);
        }

        return { iConstants, cConstants, constantMatrix };
    }
}